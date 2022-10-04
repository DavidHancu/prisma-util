
<div align="center">
  <h1>Prisma Util</h1>
  <a href="https://www.npmjs.com/package/prisma-util"><img src="https://img.shields.io/npm/dt/prisma-util" /></a>
  <a href="https://github.com/DavidHancu/prisma-util/blob/main/CONTRIBUTING.MD"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" /></a>
  <a href="https://github.com/DavidHancu/prisma-util/blob/main/LICENSE"><img src="https://img.shields.io/github/license/DavidHancu/prisma-util" /></a>
  <br />
  <br />
  <a href="#what-is-prisma-util">What is Prisma Util?</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#how-to-use">How to use?</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#the-configuration-file">The configuration file</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#support">Support</a>
  
  <br />
  <hr />
</div>

## What is Prisma Util?

Prisma Util is an easy to use tool that merges multiple Prisma schema files, allows extending of models, resolves naming conflicts and provides easy access to Prisma commands and timing reports. It's mostly a plug-and-play replacement, with an easy confirguration file.

### Requirements:

- [**Node.js**](https://nodejs.org/en/download/): Node.js v10 or higher

## How to Use?

    npx prisma-util [options]

The Prisma Util is built on top of Prisma, and as such all arguments and commands are the same as the ones from the [official documentation](https://www.prisma.io/docs/reference/api-reference/command-reference). The only additional parameter available is `--config` and it allows you to change the path of the config file (default: `prisma-util.config.mjs`).

## The configuration file

## Table of Contents

1. [Concepts](#include-files)
    1. [Running Commands](#running-commands)
    2. [Timings & Reports](#timings--reports)
    3. [Model & Column Representation](#model--column-representation)
    4. [Resolving Conflicts](#resolving-conflicts)
    5. [Automatic Mapper & Experimental Features](#automatic-mapper--experimental-features)
    6. [Debugging and Common Errors](#debugging-and-common-errors)
    7. [Polyfills](#polyfills)
2. [Configuration](#configuration)
    1. [Include Files](#include-files)
    2. [Excluding Models](#excluding-models)
    3. [Base Schema](#base-schema)
    4. [Cross-file Relations](#cross-file-relations)
    5. [Defining Cross-file Relations](#defining-cross-file-relations)
    6. [Extending Models & Inheritance](#extending-models--inheritance)
    7. [Code-generated schemas](#code-generated-schemas)
    8. [pg_trgm Support](#pgtrgm-support)

## Concepts

### Running Commands

Prisma Util is mostly a plug-and-play replacement for Prisma. To run commands, use the following command:

```
npx prisma-util [options]
```

The options are indicated in the [official documentation](https://www.prisma.io/docs/reference/api-reference/command-reference).

If you don't want to use Prisma Util as a replacement for Prisma, you can generate a schema using:

```
npx prisma-util schema
```

Additionally, you can add `--path [path]` to change the path for the generated schema. The default path is `./node_modules/.bin/generated-schema.prisma`.

### Timings & Reports

After you execute a command, Prisma Util will always end the output stream with how long it took to run the underlaying command. The last message will always be, regardless of errors, where X and Y are variable numbers:

```
PRISMA UTIL  Command executed in Xs and Yms.
```

### Model & Column Representation

To differentiate between different files, Prisma Util uses this structure to represent files, models and columns:

```
[pathToFile]:[modelName].[columnName]
```

This would represent, in prisma schema, a file with the path `[pathToFile]` and content:

```prisma
model [modelName] {
    ...
    [columnName] [columnType] [columnConstraints]
}
```

### Resolving Conflicts

A name conflict (or conflict for short) happens when 2 models from different files share the same name. Prisma Util will allow you to choose an action for either one of them, and the conflicted files will always be shown in pairs. 

This is how a conflict message generally looks like:

```
CONFLICT  Conflicts detected, please answer the questions below.

CONFLICT  Review your schema, then choose an option to solve the conflict.

Two models have the same name, please select an action.
[filePath1]:[modelName1] and [filePath2]:[modelName2]

Your choice: (Use arrow keys)
❯ Skip [filePath1]:[modelName1]
  Skip [filePath2]:[modelName2]
  Rename [filePath1]:[modelName1]
  Rename [filePath2]:[modelName2]
```

You can navigate this menu using arrow keys, then click enter to lock onto an option. After you select an option, depending on your choice, a separate prompt might appear. If you chose `Skip`, you won't get another prompt for this conflict. If you chose `Rename`, you'll receive an imput like this where you can type the new name. As usual, clicking `Enter` will submit your new input:

```
CONFLICT  What is the new name for [fileName]:[modelName]?
```

There is also one more special conflict, and that is generated by the [Automatic Mapper](#automatic-mapper--experimental-features) when it can't process a conflict automatically. This occurs when a model from the `relations` map in your configuration has the same name as a model from another file. You'll be asked to deal with the model from the other file, as the `relations` map takes priority.

```
EXPERIMENTAL  The Automatic Mapper can't process a conflict automatically.

CONFLICT  Review your schema, then choose an option to solve the conflict.

[fileName1]:[modelName1] is referenced in your configuration file as the replacement for another model.   
However, [fileName2]:[modelName2] has the same model name as the generated one would.
Please choose one of the options below.

Your choice: (Use arrow keys)
❯ Skip [fileName2]:[modelName2]
  Rename [fileName2]:[modelName2]
```

Choosing `Skip` will omit the model from the other file and choosing `Rename` will show the same input as before:

```
CONFLICT  What is the new name for [fileName]:[modelName]?
```

### Automatic Mapper & Experimental Features

Some features are marked as Experimental and will display an ` EXPERIMENTAL ` tag in front of all of their messages. These features need to be enabled manually in the configuration file.

Experimental features are **not** features that don't work or are prone to breaking, but rather features that alterate the way Prisma Util processes commands.

### Debugging and Common Errors

Prisma Util will always show a message of what command it's running to help make debugging easier for you. An example of such message is:

```
PRISMA UTIL  prisma init --datasource-provider postgresql 
```    

Some common errors that you might encounter while using Prisma Util are:

#### `Cross-file relations are not enabled in [configurationfile].` 

This error message appears when one of your models uses a relation from a model that appears in another file. 

**Fix: Enable `crossFileRelations` in your configuration file.**

#### `Error validating field [field] in model [model]: The relation field [anotherfield] on Model [model] is missing an opposite relation field on the model [model]. Either run prisma format or add it manually.`

Prisma Util didn't resolve your relations because you didn't specify them in the configuration file.

**Fix: Enable `crossFileRelations` in your configuration file and fill in the `relations` object.**

## Polyfills

We use the term `polyfill` to describe a model that is only added to a file to satisfy an IDE extension for the purpose of creating relations. If you used a Visual Studio Code extension, you might be aware of the errors you get when you use an undefined model as a relation. To fix that, we've implemented polyfills using the `Automatic Mapper`.

To create a polyfill, just make add an almost empty model:

schema.prisma
```prisma
model Post {
    id Int @Id @default(autoincrement())
    authorId Int
    author User @relation(fields: [authorId], references: [id])
}

model User {
    id Int @Id @default(autoincrement())
    name String @unique
    posts Post[]
}
```

test.prisma
```prisma
model Reply {
    id Int @Id @default(autoincrement())
    title String @unique
    body String
}
```

Configuration file
```mjs
{
    "relations": {
        "schema.prisma:User.posts": "test.prisma:Reply"
    }
}
```

In this example, Post is the polyfill model and it will be replaced by `test.prisma:Reply`.

## Configuration

All the configuration in the following parts will be done in your configuration file. This configuration file can be changed by using `--config` when running a command (default: `prisma-util.config.mjs`).

### Include Files

To save on computational power, Prisma Util doesn't look for files and instead it requires you to add each file to the configuration file. 

```mjs 
{
    "includeFiles": ["first.prisma", "second.prisma"]
}
```

Paths in `includeFiles` are relative to your project root.
> ### **Important!**
> Don't add your base schema file inside of `includeFiles`, but in the `baseSchema` property. See [this link](#base-schema) for more information.

### Excluding Models

This section allows you to exclude models from the generated schema. Array elements follow the naming concepts from [Model & Column Representation](#model--column-representation), except the column part.

```mjs 
{
    "excludeModels": ["first.prisma:User", "second.prisma:Notification"]
}
```

Paths in `excludeModels` are relative to your project root.

### Base Schema

Prisma Util requires a base schema file to work with. This schema file **must** define a `generator` and `datasource`, otherwise you'll get an error.

```mjs
{
    "baseSchema": "base.prisma"
}
```

The path in `baseSchema` is relative to your project root.

### Cross-file Relations

Cross-files relations are relations that use model names from other files. Cross-file relations is an [experimental](#automatic-mapper--experimental-features) feature and as such you have to opt-in in order to use it.

```mjs
{
    "crossFileRelations": true
}
```

### Defining Cross-file Relations

A cross-file relation is defined as a mapping between one column and one model. All map elements follow the naming conditions described in [Model & Column Representation](#model--column-representation).

What a cross-file relation essentially does is removing (if present) the model (also called a polyfill in Prisma Util, see [this](#polyfills)) from the generated file and replace all specified relations to it with the alternative mapping from the configuration file.

Example configuration section: 

```mjs
{
    "relations": {
        "posts.prisma:Post.user": "users.prisma:User"
    }
}
```

posts.prisma:
```prisma
model User {
    id Int @id @default(autoincrement())
    posts Post[]
}
model Post {
    id Int @id @default(autoincrement())
    content String
    userId Int
    user User @relation(fields: [userId], references: [id])
}
```

users.prisma:

```prisma
model User {
    id Int @id @default(autoincrement())
    username String
    email String
}
```

This example would generate the following schema:

```prisma
model User {
    id Int @id @default(autoincrement())
    username String
    email String
    posts Post[]
}

model Post {
    id Int @id @default(autoincrement())
    content String
    userId Int
    user User @relation(fields: [userId], references: [id])
}
```

Paths in `relations` are relative to your project root.

### Extending Models & Inheritance

Prisma Util allows you to extend models from any file. Extending a model will copy all of the non-id non-relation columns to the child. This sections uses the concepts from [Model & Column Representation](#model--column-representation).

Example configuration section:
```mjs
{
    "extended": {
        "schema.prisma:Topic": "test.prisma:Post"
    }
}
```

schema.prisma:

```prisma
model Topic {
  id Int @id @default(autoincrement())
  body String
  owner Int
}
```

test.prisma:
```prisma
model Post {
    id Int @id @default(autoincrement())
    title String
}
```

This example would generate the following schema:

```prisma
model Topic {
    id Int @id @default(autoincrement())
    body String
    owner Int
    title String
}
```

Paths in `extended` are relative to your project root.

### Code-generated schemas

Generating schemas using code is an experimental feature, and as such you have to enable it in the configuration file.

To define a code generator, just create an async function that returns a `string` and pass the function to the `codeGenerators` array. The return value of this function is the entire content of a Prisma schema, exactly how you define it in a file.

To make code-generated schemas easier to use, I have created a separate package that you can use. ([@prisma-util/schema-creator](https://www.npmjs.com/package/@prisma-util/schema-creator))

```mjs
{
    codeSchemas: true, // This line will enable code schemas
    codeGenerators: [] // Each generator in this array will be called when the schema is generated
}
```

### pg_trgm Support

`pg_trgm` support is an experimental feature, meaning that you have to opt-in in order to use it. It requires 4 configuration entries to function correctly and is supported only with the `PostgreSQL` driver.

The way this feature works is that it requires a middleware to be added to Prisma. To do this, import it and call it like this:

```ts
import middleware from "./path";
prisma.$use(middleware(prisma));
```

```mjs
{
    pgtrgm: true, // This line will enable support for this feature.
    schema: "public", // The schema is required for building the SQL queries
    middleware: "path", // The path where the middleware is generated. This path is relative to your project root.
    ftsIndexes: [
        // This is the place where you specify your indexes.
        {
            type: "GIN", // This is the type of the index
            indexes: [{
                language: "english", // This is the language that will be used for the index 
                field: "fieldName", // The name of the column that will get the index
                weight: "A" // The weight of this column determines how important it is in ranking
            }]
        }
    ]
}
```

To use this feature in your code, just use `findFirst` or `findMany` and assign the query to an indexed column.

The object returned is identical to the one returned by Prisma, with the addition of the `ftsscore` field which provides the similarity between the query and the index.

> ### Caveat
> Relations are not supported currently.

To order the result of this query, just provide a column that is indexed to the `orderBy` object and it will sort using that order based on the similarity.

## Support

### Create a bug report for Prisma Util

If you see an error with Prisma Util, please create a bug report [here](https://github.com/DavidHancu/prisma-util/issues/new?assignees=&labels=&template=bug_report.md&title=).

### Submit a feature request

If you want to see a new feature added to Prisma Util, please create an issue [here](https://github.com/DavidHancu/prisma-util/issues/new?assignees=&labels=&template=feature_request.md&title=).

### Contributing

Refer to our [contribution guidelines](https://github.com/DavidHancu/prisma-util/blob/main/CONTRIBUTING.MD) for information on how to contribute.
