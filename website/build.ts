// builds the site into dist/: bun bundles the page, its css and script (hashed names), and we add
// what lives at fixed addresses.
import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "./dist",
  minify: true,
  sourcemap: "none",
  external: ["/fonts/*"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await cp("./src/public", "./dist", { recursive: true });
await cp("./src/img/share.jpg", "./dist/share.jpg");

const preload = ["sora-latin-wght-normal", "geist-latin-wght-normal"]
  .map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`)
  .join("");
const file = Bun.file("./dist/index.html");
await Bun.write(file, (await file.text()).replace("<head>", `<head>${preload}`));
for (const o of result.outputs) {
  console.log(`${(o.size / 1024).toFixed(1).padStart(7)} KB  ${o.path.replace(process.cwd() + "/", "")}`);
}
