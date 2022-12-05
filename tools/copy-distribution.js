const { writeFileSync, copyFileSync, readFileSync } = require("fs");
const { resolve, join, relative, dirname } = require("path");

const __dirname = process.cwd();

const destination = resolve(__dirname, "build");
const files = ["README.MD", "LICENSE", "package.json"];
const removedProperties = ["scripts"];

for(const file of files)
{
    if(file == "package.json")
    {
        const packageJSON = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
        for(const property of removedProperties)
            delete packageJSON[property];
        writeFileSync(join(destination, file), JSON.stringify(packageJSON, null, 4));
    } else
    {
        copyFileSync(resolve(__dirname, file), resolve(destination, file));
    }
}