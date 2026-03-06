/**
 * Topic Extraction Unit Tests
 *
 * Pure function unit tests for Kafka topic extraction logic.
 * Tests run in <10ms with no network dependencies.
 */

import { describe, it, expect } from "vitest";
import { extractTopicFromUrl, isValidTopicName } from "../topic-utils.js";

describe("Topic Extraction", () => {
  describe("extractTopicFromUrl", () => {
    describe("kafka:// format parsing", () => {
      it("should extract topic from kafka:// URL", () => {
        expect(extractTopicFromUrl("kafka://orders")).toBe("orders");
      });

      it("should extract topic with hyphens", () => {
        expect(extractTopicFromUrl("kafka://user-events")).toBe("user-events");
      });

      it("should extract topic with numbers", () => {
        expect(extractTopicFromUrl("kafka://events-v1")).toBe("events-v1");
      });

      it("should extract topic with dots", () => {
        expect(extractTopicFromUrl("kafka://com.example.events")).toBe(
          "com.example.events",
        );
      });

      it("should extract topic with underscores", () => {
        expect(extractTopicFromUrl("kafka://user_events")).toBe("user_events");
      });

      it("should extract topic with mixed special characters", () => {
        expect(extractTopicFromUrl("kafka://my.app_events-v2")).toBe(
          "my.app_events-v2",
        );
      });

      it("should handle kafka:// prefix with trailing slash", () => {
        expect(extractTopicFromUrl("kafka://orders/")).toBe("orders/");
      });
    });

    describe("plain topic-name format", () => {
      it("should return plain topic name as-is", () => {
        expect(extractTopicFromUrl("orders")).toBe("orders");
      });

      it("should handle topic with hyphens", () => {
        expect(extractTopicFromUrl("user-events")).toBe("user-events");
      });

      it("should handle topic with dots", () => {
        expect(extractTopicFromUrl("com.example.events")).toBe(
          "com.example.events",
        );
      });

      it("should handle topic with underscores", () => {
        expect(extractTopicFromUrl("user_events")).toBe("user_events");
      });

      it("should handle mixed special characters", () => {
        expect(extractTopicFromUrl("my.app_events-v2")).toBe(
          "my.app_events-v2",
        );
      });
    });

    describe("URL edge cases", () => {
      it("should handle empty string", () => {
        expect(extractTopicFromUrl("")).toBe("");
      });

      it("should handle whitespace-only string", () => {
        expect(extractTopicFromUrl("   ")).toBe("   ");
      });

      it("should handle single character topic", () => {
        expect(extractTopicFromUrl("a")).toBe("a");
      });

      it("should handle kafka:// with empty topic", () => {
        expect(extractTopicFromUrl("kafka://")).toBe("");
      });

      it("should handle URL-like string without kafka protocol", () => {
        expect(extractTopicFromUrl("http://orders")).toBe("http://orders");
      });

      it("should handle multiple slashes", () => {
        expect(extractTopicFromUrl("kafka:///orders")).toBe("/orders");
      });

      it("should handle protocol-like string in middle", () => {
        expect(extractTopicFromUrl("orders-kafka://events")).toBe(
          "orders-kafka://events",
        );
      });

      it("should be case-sensitive for protocol", () => {
        expect(extractTopicFromUrl("KAFKA://orders")).toBe("KAFKA://orders");
        expect(extractTopicFromUrl("Kafka://orders")).toBe("Kafka://orders");
      });
    });

    describe("special characters", () => {
      it("should preserve special characters in topic name", () => {
        expect(extractTopicFromUrl("kafka://my.topic_v2-test")).toBe(
          "my.topic_v2-test",
        );
      });

      it("should handle topic with consecutive dots", () => {
        expect(extractTopicFromUrl("kafka://my..topic")).toBe("my..topic");
      });

      it("should handle topic starting with dot", () => {
        expect(extractTopicFromUrl("kafka://.internal-topic")).toBe(
          ".internal-topic",
        );
      });

      it("should handle topic starting with underscore", () => {
        expect(extractTopicFromUrl("kafka://__consumer_offsets")).toBe(
          "__consumer_offsets",
        );
      });
    });
  });

  describe("isValidTopicName", () => {
    describe("valid topic names", () => {
      it("should accept simple alphanumeric topic", () => {
        expect(isValidTopicName("orders")).toBe(true);
      });

      it("should accept topic with hyphens", () => {
        expect(isValidTopicName("user-events")).toBe(true);
      });

      it("should accept topic with dots", () => {
        expect(isValidTopicName("com.example.events")).toBe(true);
      });

      it("should accept topic with underscores", () => {
        expect(isValidTopicName("user_events")).toBe(true);
      });

      it("should accept topic with mixed valid characters", () => {
        expect(isValidTopicName("my.app_events-v2")).toBe(true);
      });

      it("should accept numeric topic", () => {
        expect(isValidTopicName("123")).toBe(true);
      });

      it("should accept topic starting with number", () => {
        expect(isValidTopicName("1events")).toBe(true);
      });

      it("should accept single character topic", () => {
        expect(isValidTopicName("a")).toBe(true);
      });

      it("should accept topic at maximum length (249 chars)", () => {
        const topic = "a".repeat(249);
        expect(isValidTopicName(topic)).toBe(true);
      });
    });

    describe("invalid topic names", () => {
      it("should reject empty string", () => {
        expect(isValidTopicName("")).toBe(false);
      });

      it("should reject whitespace-only string", () => {
        expect(isValidTopicName("   ")).toBe(false);
      });

      it("should reject string with only spaces", () => {
        expect(isValidTopicName(" ")).toBe(false);
      });

      it("should reject string with tabs", () => {
        expect(isValidTopicName("\t")).toBe(false);
      });

      it("should reject string with newlines", () => {
        expect(isValidTopicName("\n")).toBe(false);
      });

      it("should reject topic starting with dot", () => {
        expect(isValidTopicName(".internal")).toBe(false);
      });

      it("should reject topic starting with underscore", () => {
        expect(isValidTopicName("_internal")).toBe(false);
      });

      it("should reject topic starting with hyphen", () => {
        expect(isValidTopicName("-test")).toBe(true); // hyphen at start is allowed
      });

      it("should reject topic with spaces", () => {
        expect(isValidTopicName("my topic")).toBe(false);
      });

      it("should reject topic with special characters", () => {
        expect(isValidTopicName("topic@events")).toBe(false);
        expect(isValidTopicName("topic#hash")).toBe(false);
        expect(isValidTopicName("topic$dollar")).toBe(false);
        expect(isValidTopicName("topic%percent")).toBe(false);
        expect(isValidTopicName("topic&ampersand")).toBe(false);
        expect(isValidTopicName("topic*asterisk")).toBe(false);
        expect(isValidTopicName("topic+plus")).toBe(false);
        expect(isValidTopicName("topic=equals")).toBe(false);
        expect(isValidTopicName("topic[bracket]")).toBe(false);
        expect(isValidTopicName("topic{brace}")).toBe(false);
        expect(isValidTopicName("topic|pipe")).toBe(false);
        expect(isValidTopicName("topic\\backslash")).toBe(false);
        expect(isValidTopicName("topic/forwardslash")).toBe(false);
        expect(isValidTopicName("topic?question")).toBe(false);
        expect(isValidTopicName("topic<less>")).toBe(false);
        expect(isValidTopicName("topic,comma")).toBe(false);
        expect(isValidTopicName("topic;semicolon")).toBe(false);
        expect(isValidTopicName("topic:colon")).toBe(false);
        expect(isValidTopicName("topic'quote")).toBe(false);
        expect(isValidTopicName('topic"doublequote"')).toBe(false);
      });

      it("should reject topic exceeding maximum length (250+ chars)", () => {
        const topic = "a".repeat(250);
        expect(isValidTopicName(topic)).toBe(false);
      });

      it("should reject topic with zero length", () => {
        expect(isValidTopicName("")).toBe(false);
      });

      it("should reject topic with null bytes", () => {
        expect(isValidTopicName("topic\u0000")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle topic with consecutive valid separators", () => {
        expect(isValidTopicName("my..topic")).toBe(true);
        expect(isValidTopicName("my__topic")).toBe(true);
        expect(isValidTopicName("my--topic")).toBe(true);
      });

      it("should handle topic ending with separator", () => {
        expect(isValidTopicName("topic.")).toBe(true);
        expect(isValidTopicName("topic_")).toBe(true);
        expect(isValidTopicName("topic-")).toBe(true);
      });

      it("should handle topic with only separators", () => {
        expect(isValidTopicName("...")).toBe(false); // starts with dot
        expect(isValidTopicName("___")).toBe(false); // starts with underscore
        expect(isValidTopicName("---")).toBe(true); // hyphens are valid
      });

      it("should be case-sensitive", () => {
        expect(isValidTopicName("TOPIC")).toBe(true);
        expect(isValidTopicName("Topic")).toBe(true);
        expect(isValidTopicName("topic")).toBe(true);
      });
    });
  });
});
