import fs from "fs";
import path from "path";

export function getRealDirectory()
{
    const resolvedDir = path.resolve('.')
    const realDir = fs.realpathSync.native(resolvedDir)
    return realDir;
}

export function convertPathToLocal(p: string)
{
    return path.join(getRealDirectory(), p);
}