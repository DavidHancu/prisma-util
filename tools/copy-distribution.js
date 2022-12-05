import { writeFileSync, copyFileSync, readFileSync } from "fs";
import { resolve, join, relative, dirname } from "path";

const _dirname = resolve(`../${process.cwd()}`);

const destination = resolve(_dirname, "build");
const files = ["README.MD", "LICENSE"];
const removedProperties = ["scripts"];

for(const file of files)
{
    if(file == "package.json")
    {
        const packageJSON = JSON.parse(readFileSync(resolve(_dirname, "package.json"), "utf8"));
        for(const property of removedProperties)
            delete packageJSON[property];
        writeFileSync(join(destination, file), JSON.stringify(packageJSON, null, 4));
    } else
    {
        copyFileSync(resolve(_dirname, file), resolve(destination, file));
    }
}