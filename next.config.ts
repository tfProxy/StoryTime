import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // AGENTS.md has its own, shorter Next.js note; don't let `next dev` add the generic block.
  agentRules: false,
};

export default nextConfig;
