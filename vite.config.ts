import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const buildTime = new Date().toISOString();
const generatedBuildVersion = buildTime
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const buildVersion =
  process.env.VITE_BUILD_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  generatedBuildVersion;
const serviceWorkerTemplate = readFileSync(
  new URL("./public/sw.js", import.meta.url),
  "utf8",
);

export function precacheAssetPaths(fileNames: readonly string[]): string[] {
  const paths: string[] = [];
  for (const fileName of fileNames) {
    if (fileName === "sw.js") continue;
    const path = `/${fileName}`;
    const insertionIndex = paths.findIndex((candidate) => candidate > path);
    if (insertionIndex === -1) {
      paths.push(path);
    } else {
      paths.splice(insertionIndex, 0, path);
    }
  }
  return paths;
}

export function renderServiceWorker(
  template: string,
  releaseId: string,
  precacheAssets: readonly string[],
): string {
  const withRelease = template.replace(
    "const RELEASE_ID = '__RELEASE_ID__'",
    `const RELEASE_ID = ${JSON.stringify(releaseId)}`,
  );
  const generatedWorker = withRelease.replace(
    "const PRECACHE_ASSETS = []",
    `const PRECACHE_ASSETS = ${JSON.stringify(precacheAssets)}`,
  );

  if (
    generatedWorker.includes("__RELEASE_ID__") ||
    generatedWorker.includes("const PRECACHE_ASSETS = []")
  ) {
    throw new Error("No fue posible generar el precache del service worker");
  }

  return generatedWorker;
}

export function createServiceWorkerPlugin(releaseId: string): Plugin {
  return {
    name: "operations-service-worker-precache",
    apply: "build",
    writeBundle(options, bundle) {
      const outputDirectory = options.dir
        ? resolve(options.dir)
        : dirname(resolve(options.file ?? "dist/index.html"));
      const precacheAssets = precacheAssetPaths(
        Object.values(bundle).map((asset) => asset.fileName),
      );
      const generatedWorker = renderServiceWorker(
        serviceWorkerTemplate,
        releaseId,
        precacheAssets,
      );
      writeFileSync(resolve(outputDirectory, "sw.js"), generatedWorker);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const releaseId =
    env.VITE_RELEASE_ID?.trim() ||
    `${buildVersion}-${buildTime.replace(/\D/g, "")}`;
  const additionalAllowedHosts = (
    env["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"] ?? ""
  )
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => {
      try {
        return new URL(host.includes("://") ? host : `https://${host}`).hostname;
      } catch {
        return host;
      }
    });

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            storage: ["dexie"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(packageMetadata.version),
      "import.meta.env.BUILD_VERSION": JSON.stringify(buildVersion),
      "import.meta.env.BUILD_TIME": JSON.stringify(buildTime),
      "import.meta.env.RELEASE_ID": JSON.stringify(releaseId),
    },
    plugins: [react(), tailwindcss(), createServiceWorkerPlugin(releaseId)],
    server: {
      port: 5173,
      allowedHosts: additionalAllowedHosts,
    },
  };
});
