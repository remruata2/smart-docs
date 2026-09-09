#!/usr/bin/env node

// Register ts-node to allow requiring TypeScript modules from JS
require("ts-node").register({ transpileOnly: true });

const { SemanticVectorService } = require("../src/lib/semantic-vector.ts");

async function generateSemanticVectors() {
  try {
    const force = process.argv.includes("--force") || process.argv.includes("--all");
    console.log(`🚀 Starting semantic vector generation (force=${force})...`);

    await SemanticVectorService.batchUpdateSemanticVectors(force);

    console.log("🎉 Semantic vector generation completed!");
  } catch (error) {
    console.error("❌ Semantic vector generation failed:", error);
    process.exit(1);
  }
}

generateSemanticVectors();
