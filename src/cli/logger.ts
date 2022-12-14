import chalk from "chalk";
import { errorTag, prismaCLITag, warningTag, conflictTag, successTag, experimentalTag, updateTag } from "./messages.js";
import gradient from "gradient-string";

export function log(text: string, before?: string)
{
    console.log(`${before ? before : ""}${prismaCLITag} ${chalk.gray(text)}`);
}

export function error(text: string, before?: string)
{
    console.log(`${before ? before : ""}${errorTag} ${chalk.red(text)}`);
}

export function update(text: string, before?: string)
{
    console.log(`${before ? before : ""}${updateTag} ${chalk.cyan(text)}`);
}

export function warn(text: string, before?: string)
{
    console.log(`${before ? before : ""}${warningTag} ${chalk.yellow(text)}`);
}

export function success(text: string, before?: string)
{
    console.log(`${before ? before : ""}${successTag} ${chalk.green(text)}`);
}

export function conflict(text: string, before?: string)
{
    console.log(`${before ? before : ""}${conflictTag} ${chalk.magenta(text)}`);
}

export function experimental(text: string, before?: string)
{
    console.log(`${before ? before : ""}${experimentalTag} ${chalk.white(text)}`);
}

export function interactive(text: string, before?: string)
{
    console.log(`${before ? before : ""}${gradient.passion(text)}`);
}