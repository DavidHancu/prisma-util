import AbstractCreator from './creator.js';
import Enum from './enum.js';
import { SchemaCreator } from './index.js';

/** Hidden column class for internal use. */
class Column {
    /** Column name. */
    readonly name: string;
    /** Column type. */
    readonly type: string;
    /** Column constraints. */
    readonly constraints: string[];
    constructor(name: string, type: string, ...constraints: string[])
    {
        this.name = name;
        this.type = type;
        this.constraints = constraints;
    }
}
/** Model that will be created in your Prisma schema.
 * 
 * When resolving conflicts, this model will be displayed as `codeSchemas:[ModelName]` so you can differentiate between .schema files and code generated models.
 * 
 * For additional functionality, you can use the same format (`codeSchemas:[ModelName].[columnName]`) to remap columns using the Automatic Remapper.
 */
export default class Model extends AbstractCreator {
    /** Reference to creator for handling chaining. */
    private creator: SchemaCreator;
    /** Model name. */
    _name: string;
    /** List of columns. */
    columns: Column[];
    /** List of model attributes. */
    attributes: string[];
    constructor(creator: SchemaCreator, name: string)
    {
        super();
        this.creator = creator;
        this._name = name;
        this.attributes = [];
        this.columns = [];
    }

    /** Change this model's name. */
    name(name: string) {
        this._name = name;
        return this;
    }

    /** Create a new column. */
    column(name: string, type: string, ...constraints: string[])
    {
        this.columns.push(new Column(name, type, ...constraints));
        return this;
    }

    /**Add constraints to this model. */
    constraints(...constraints: string[])
    {
        this.attributes.push(...constraints);
        return this;
    }

    model(name: string): Model {
        return this.creator.pushModel(this).model(name);
    }

    enum(name: string): Enum {
        return this.creator.pushModel(this).enum(name);
    }

    /** You should not call this method yourself. */
    beforeBuild() {
        if(this.attributes.length == 0)
            return this;
        while(this.columns.filter(column => column.type == "").length > 0)
            this.columns.splice(this.columns.indexOf(this.columns.filter(column => column.type == "")[0]), 1)
        
        for(const attr of this.attributes)
            this.column(attr, "");
        return this;
    }

    build(): string {
        return this.creator.pushModel(this).build();
    }
}