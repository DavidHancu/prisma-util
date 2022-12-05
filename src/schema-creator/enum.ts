import AbstractCreator from "./creator.js";
import { SchemaCreator } from "./index.js";
import Model from "./model.js";

/** Enum that will be created in your Prisma schema.
 * 
 * When resolving conflicts, this enum will be displayed as `codeSchemas:[EnumName]` so you can differentiate between .schema files and code generated models.
 * 
 * For additional functionality, you can use the same format (`codeSchemas:[ModelName].[columnName]`) to remap columns using the Automatic Remapper.
 */
 export default class Enum extends AbstractCreator {
    /** Reference to creator for handling chaining. */
    private creator: SchemaCreator;
    /** Enum name. */
    _name: string;
    /** List of items. */
    items: string[];
    constructor(creator: SchemaCreator, name: string)
    {
        super();
        this.creator = creator;
        this._name = name;
        this.items = [];
    }

    /** Change this enum's name. */
    name(name: string) {
        this._name = name;
        return this;
    }

    /** Add an enum item. */
    item(name: string)
    {
        this.items.push(name);
        return this;
    }

    model(name: string): Model {
        return this.creator.pushEnum(this).model(name);
    }

    enum(name: string): Enum {
        return this.creator.pushEnum(this).enum(name);
    }

    /** You should not call this method yourself. */
    beforeBuild() {
        return this;
    }

    build(): string {
        return this.creator.pushEnum(this).build();
    }
}