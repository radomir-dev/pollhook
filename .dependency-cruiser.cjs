/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle means two modules cannot be understood or tested in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment: "An unreachable module is dead code that knip can miss.",
      from: { orphan: true, pathNot: ["^src/cli\\.ts$"] },
      to: {},
    },
    {
      name: "db-is-a-leaf",
      severity: "error",
      comment: "The store must not know about polling, adapters or the CLI.",
      from: { path: "^src/db/" },
      to: { path: "^src/(adapters|poller|cli|daemon)/" },
    },
    {
      name: "adapters-are-independent",
      severity: "error",
      comment: "One adapter must never import another; shared helpers live in adapters/common.",
      from: { path: "^src/adapters/([^/]+)\\.ts$" },
      to: { path: "^src/adapters/", pathNot: "^src/adapters/common\\.ts$" },
    },
    {
      name: "core-does-not-import-the-cli",
      severity: "error",
      comment: "The poller, adapters and store are reusable without the command line.",
      from: { path: "^src/(adapters|db|poller)" },
      to: { path: "^src/(cli|daemon)/" },
    },
    {
      name: "sockets-only-in-daemon-and-cli",
      severity: "error",
      comment: "net and http belong to the transport layer, not to adapters.",
      from: { pathNot: "^src/(daemon|cli)/" },
      to: { dependencyTypes: ["core"], path: "^node:(net|http)$" },
    },
    {
      name: "no-dev-dependencies-in-src",
      severity: "error",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "^(\\.slim|dist)/" },
  },
};
