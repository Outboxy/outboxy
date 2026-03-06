import { createProjectConfig } from "../testing-utils/src/vitest-helpers.js";

export default createProjectConfig({
  name: "publisher-kafka",
  needsContainers: true,
});
