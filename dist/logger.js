import chalk from "chalk";
import { errorTag, prismaCLITag, warningTag, conflictTag, successTag, experimentalTag, updateTag } from "./messages.js";
export function log(text, before) {
    console.log(`${before ? before : ""}${prismaCLITag} ${chalk.gray(text)}`);
}
export function error(text, before) {
    console.log(`${before ? before : ""}${errorTag} ${chalk.red(text)}`);
}
export function update(text, before) {
    console.log(`${before ? before : ""}${updateTag} ${chalk.cyan(text)}`);
}
export function warn(text, before) {
    console.log(`${before ? before : ""}${warningTag} ${chalk.yellow(text)}`);
}
export function success(text, before) {
    console.log(`${before ? before : ""}${successTag} ${chalk.green(text)}`);
}
export function conflict(text, before) {
    console.log(`${before ? before : ""}${conflictTag} ${chalk.magenta(text)}`);
}
export function experimental(text, before) {
    console.log(`${before ? before : ""}${experimentalTag} ${chalk.white(text)}`);
}
