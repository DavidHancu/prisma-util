import Enum from "./enum.js";
import Model from "./model.js";

/** Abstract Creator that Model and Enum extend. */
export default abstract class AbstractCreator {
    /** Create a new model. */
    abstract model(name: string): Model;
    /** Create a new enum. */
    abstract enum(name: string): Enum;
    /** Build the schema into a string that can be parsed. */
    abstract build(): string;
}