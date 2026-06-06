import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Needed so standalone traces files across the monorepo
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
