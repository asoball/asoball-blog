if (process.versions.node !== "22.23.4")
  throw new Error("Run through pnpm to use the pinned Node runtime.");
console.log(`Node ${process.versions.node}`);
