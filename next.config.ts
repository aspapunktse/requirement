import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The design proposals landing page is a static file; serve it at /design as well.
  rewrites() {
    return [{ source: "/design", destination: "/design/index.html" }];
  },
};

export default nextConfig;
