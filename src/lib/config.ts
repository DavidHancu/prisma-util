import path from "path";
import * as fs from 'fs/promises';
import { convertPathToLocal } from "./utils.js";
import { pathToFileURL } from "url";
import generated from "./generated.js";

export function getConfig()
{
    return generated as any;
}