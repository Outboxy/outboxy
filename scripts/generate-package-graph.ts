import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// Dependency type information
interface DependencyInfo {
  name: string;
  type: "direct" | "peer" | "peer-optional";
}

// Edge with type information
interface Edge {
  from: string;
  to: string;
  type: "direct" | "peer" | "peer-optional";
}

// Packages to exclude from the graph
const EXCLUDED_PACKAGES = new Set(["e2e", "testing-utils", "logging"]);

// Cluster configuration with package assignments and colors
interface ClusterConfig {
  label: string;
  packages: string[];
  color: string;
}

const CLUSTERS: Record<string, ClusterConfig> = {
  cluster_apps: {
    label: "Applications",
    packages: ["api", "worker"],
    color: "#90EE90", // light green
  },
  cluster_db_adapters: {
    label: "Database Adapters",
    packages: ["db-adapter-core", "db-adapter-postgres", "db-adapter-mysql"],
    color: "#87CEEB", // sky blue
  },
  cluster_dialects: {
    label: "Database Dialects",
    packages: ["dialect-core", "dialect-postgres", "dialect-mysql"],
    color: "#B0E0E6", // powder blue
  },
  cluster_publishers: {
    label: "Event Publishers",
    packages: ["publisher-core", "publisher-http", "publisher-kafka"],
    color: "#DDA0DD", // plum
  },
  cluster_sdk: {
    label: "SDKs",
    packages: ["sdk", "sdk-nestjs"],
    color: "#FFA07A", // light salmon
  },
  cluster_core: {
    label: "Core",
    packages: ["schema", "migrations"],
    color: "#FFD700", // gold
  },
};

// Reverse lookup: package name -> cluster key
const PACKAGE_TO_CLUSTER: Record<string, string> = {};
for (const [clusterKey, config] of Object.entries(CLUSTERS)) {
  for (const pkg of config.packages) {
    PACKAGE_TO_CLUSTER[pkg] = clusterKey;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = join(__dirname, "..", "packages");
const OUTPUT_DOT = join(__dirname, "..", "docs", "package-graph.dot");
const OUTPUT_SVG = join(__dirname, "..", "docs", "package-graph.svg");

/**
 * Get internal dependencies with type information
 */
function getInternalDependencies(pkg: PackageJson): DependencyInfo[] {
  const deps: DependencyInfo[] = [];

  // Direct dependencies
  for (const dep of Object.keys(pkg.dependencies ?? {}).filter((d) =>
    d.startsWith("@outboxy/"),
  )) {
    deps.push({ name: dep, type: "direct" });
  }

  // Peer dependencies
  for (const dep of Object.keys(pkg.peerDependencies ?? {}).filter((d) =>
    d.startsWith("@outboxy/"),
  )) {
    const isOptional = pkg.peerDependenciesMeta?.[dep]?.optional === true;
    deps.push({ name: dep, type: isOptional ? "peer-optional" : "peer" });
  }

  return deps;
}

function shortName(name: string): string {
  return name.replace("@outboxy/", "");
}

/**
 * Find all cycles in the dependency graph using DFS
 * Returns a set of edges that form cycles (as "from->to" strings)
 */
function findCycles(adjacencyList: Map<string, string[]>): Set<string> {
  const cycleEdges = new Set<string>();
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const parent = new Map<string, string | null>();

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    parent.set(node, null);

    for (const neighbor of adjacencyList.get(node) || []) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, node);
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recStack.has(neighbor)) {
        // Found a cycle - backtrack to find all edges in the cycle
        let current: string | null = node;
        const cyclePath: string[] = [];

        while (current !== null && current !== neighbor) {
          cyclePath.unshift(current);
          current = parent.get(current) || null;
        }
        cyclePath.unshift(neighbor);
        cyclePath.push(node); // Close the cycle

        // Add all edges in the cycle to the set
        for (let i = 0; i < cyclePath.length - 1; i++) {
          cycleEdges.add(`${cyclePath[i]}->${cyclePath[i + 1]}`);
        }
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const node of adjacencyList.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycleEdges;
}

/**
 * Get cluster key for a package, or undefined if not in any cluster
 */
function getClusterForPackage(packageName: string): string | undefined {
  return PACKAGE_TO_CLUSTER[packageName];
}

/**
 * Get DOT edge style for a given edge type
 */
function getEdgeStyle(edge: Edge, isCircular: boolean): string {
  if (isCircular) {
    return `  "${edge.from}" -> "${edge.to}" [color=red, penwidth=2.0, label="⚠ CIRCULAR"]`;
  }

  switch (edge.type) {
    case "direct":
      return `  "${edge.from}" -> "${edge.to}" [color=gray50]`;
    case "peer":
      return `  "${edge.from}" -> "${edge.to}" [color="#4169E1", style=dashed]`;
    case "peer-optional":
      return `  "${edge.from}" -> "${edge.to}" [color="#9370DB", style=dotted]`;
  }
}

/**
 * Generate DOT content with clusters and color coding
 */
function generateDot(
  nodes: Set<string>,
  edges: Edge[],
  cycleEdges: Set<string>,
): string {
  const lines: string[] = [];
  const nodesByCluster: Record<string, string[]> = {};
  const unclusteredNodes: string[] = [];

  // Separate nodes by cluster
  for (const node of nodes) {
    const cluster = getClusterForPackage(node);
    if (cluster) {
      if (!nodesByCluster[cluster]) {
        nodesByCluster[cluster] = [];
      }
      nodesByCluster[cluster].push(node);
    } else {
      unclusteredNodes.push(node);
    }
  }

  lines.push("digraph packages {");
  lines.push("  rankdir=LR");
  lines.push('  fontname="Helvetica"');
  lines.push("  fontsize=11");
  lines.push("");
  lines.push("  // Default node and edge styles");
  lines.push('  node [shape=box, style=filled, fontname="Helvetica"]');
  lines.push('  edge [fontname="Helvetica", fontsize=9]');
  lines.push("");

  // Generate clusters (subgraphs)
  for (const [clusterKey, clusterNodes] of Object.entries(nodesByCluster)) {
    if (clusterNodes.length === 0) continue;

    const config = CLUSTERS[clusterKey];
    lines.push(`  // ${config.label}`);
    lines.push(`  subgraph ${clusterKey} {`);
    lines.push(`    label="${config.label}"`);
    lines.push(`    style=filled`);
    lines.push(`    color="${config.color}"`);
    lines.push(`    fillcolor="${config.color}22"`); // 22 = low opacity hex
    lines.push(`    fontname="Helvetica-Bold"`);

    for (const node of clusterNodes) {
      lines.push(`    "${node}" [fillcolor="${config.color}"]`);
    }

    lines.push("  }");
    lines.push("");
  }

  // Add unclustered nodes (if any)
  if (unclusteredNodes.length > 0) {
    lines.push("  // Other packages");
    for (const node of unclusteredNodes) {
      lines.push(`  "${node}" [fillcolor=lightgray]`);
    }
    lines.push("");
  }

  // Generate edges - highlight circular dependencies in red
  lines.push("  // Dependencies");
  for (const edge of edges) {
    const edgeKey = `${edge.from}->${edge.to}`;
    const isCircular = cycleEdges.has(edgeKey);
    lines.push(getEdgeStyle(edge, isCircular));
  }

  // Add legend
  lines.push("");
  lines.push("  // Legend");
  lines.push("  subgraph cluster_legend {");
  lines.push("    label=Legend");
  lines.push("    style=filled");
  lines.push('    color="lightgray"');
  lines.push('    fillcolor="white"');
  lines.push('    fontname="Helvetica-Bold"');
  lines.push("");
  lines.push(
    "    node [shape=box, style=filled, fillcolor=white, width=0.1, height=0.1]",
  );
  lines.push("");
  lines.push('    l_direct [label=""]');
  lines.push('    l_peer [label=""]');
  lines.push('    l_peer_opt [label=""]');
  lines.push("");
  lines.push("    l_direct -> l_peer [style=invis]");
  lines.push("    l_peer -> l_peer_opt [style=invis]");
  lines.push("");
  lines.push(
    '    legend_direct [label="Direct dependency", shape=note, fontsize=9, fillcolor=white, color=gray50]',
  );
  lines.push(
    '    legend_peer [label="Peer dependency", shape=note, fontsize=9, fillcolor=white, color="#4169E1"]',
  );
  lines.push(
    '    legend_optional [label="Optional peer dependency", shape=note, fontsize=9, fillcolor=white, color="#9370DB"]',
  );
  lines.push("");
  lines.push("    { rank=same; l_direct legend_direct }");
  lines.push("    { rank=same; l_peer legend_peer }");
  lines.push("    { rank=same; l_peer_opt legend_optional }");
  lines.push("");
  lines.push(
    '    l_direct -> legend_direct [color=gray50, dir=none, label="solid line", fontsize=8]',
  );
  lines.push(
    '    l_peer -> legend_peer [color="#4169E1", style=dashed, dir=none, label="dashed", fontsize=8]',
  );
  lines.push(
    '    l_peer_opt -> legend_optional [color="#9370DB", style=dotted, dir=none, label="dotted", fontsize=8]',
  );
  lines.push("  }");

  lines.push("}");
  return lines.join("\n");
}

function main() {
  const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => !EXCLUDED_PACKAGES.has(dirent.name))
    .map((dirent) => {
      const pkgPath = join(PACKAGES_DIR, dirent.name, "package.json");
      try {
        const content = readFileSync(pkgPath, "utf-8");
        return JSON.parse(content) as PackageJson;
      } catch {
        return null;
      }
    })
    .filter((pkg): pkg is PackageJson => pkg !== null);

  const nodes = new Set<string>();
  const edges: Edge[] = [];
  const adjacencyList = new Map<string, string[]>();

  for (const pkg of packages) {
    const from = shortName(pkg.name);
    nodes.add(from);

    const deps = getInternalDependencies(pkg);
    const fromDeps: string[] = [];

    for (const dep of deps) {
      const to = shortName(dep.name);
      // Only include dependencies that are in our package set
      if (PACKAGE_TO_CLUSTER[to]) {
        nodes.add(to);
        edges.push({ from, to, type: dep.type });
        fromDeps.push(to);
      }
    }

    adjacencyList.set(from, fromDeps);
  }

  // Detect circular dependencies
  const cycleEdges = findCycles(adjacencyList);

  if (cycleEdges.size > 0) {
    console.warn("⚠️  Warning: Circular dependencies detected:");
    for (const edge of cycleEdges) {
      console.warn(`   ${edge}`);
    }
    console.warn("");
  }

  // Generate DOT content
  const dot = generateDot(nodes, edges, cycleEdges);

  writeFileSync(OUTPUT_DOT, dot);
  console.warn(`DOT file written to: ${OUTPUT_DOT}`);

  try {
    execSync(`dot -Tsvg "${OUTPUT_DOT}" -o "${OUTPUT_SVG}"`);
    console.warn(`SVG file written to: ${OUTPUT_SVG}`);
  } catch (_error) {
    console.error("Failed to generate SVG. Is Graphviz installed?");
    console.error("Run: brew install graphviz");
  }
}

main();
