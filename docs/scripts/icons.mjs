// Renders the PNG icons from public/favicon.svg, for the browsers that do not
// take an SVG: `node scripts/icons.mjs`, then commit the two files.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const out = (name) => new URL(`../public/${name}`, import.meta.url);

// A tab icon, as drawn.
await writeFile(out("favicon-32.png"), await sharp(Buffer.from(svg), { density: 288 }).resize(32, 32).png().toBuffer());

// iOS rounds the corners itself: the home-screen icon is a full square.
const square = svg.replace(/ rx="\d+"/, "");
await writeFile(out("apple-touch-icon.png"), await sharp(Buffer.from(square), { density: 288 }).resize(180, 180).png().toBuffer());

console.log("icons written");
