import { readFileSync, writeFileSync } from "fs";
import path from "path";

const __dirname = process.cwd();
const pathToUse = path.join(__dirname, "build", "cli", "index.js");

const current = readFileSync(pathToUse, "utf8").split("\n");
writeFileSync(pathToUse, 
`${current.slice(0, 1).join("\n")}
process.env.ENV = "dev";
${current.slice(1).join("\n")}`
);