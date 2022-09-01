# Welcome!

Thanks for trying to make Prisma Util better for everyone! On this page, you'll see how you can start working on the prisma-util CLI right away by creating a local copy of the code, editing it and then submitting the changes in a pull request. We review all pull requests accordingly, so make sure that your code is clean and readable.

## Contributing Code

To start working on Prisma Util, you need to follow the steps below. Keep in mind that the general prerequisites are a requirement and can't be skipped. The repository is coded in `Typescript`, so make sure that you don't make changes in the `dist` directory, but rather the `src` one.

## General Prerequisites

1. Install Node.js `>=10` minimum, [latest LTS is recommended](https://nodejs.org/en/about/releases/)

   - Recommended: use [`nvm`](https://github.com/nvm-sh/nvm) for managing Node.js versions

## General Setup

To set up and create your development environment, follow these steps:

```bash
git clone https://github.com/DavidHancu/prisma-util.git
cd prisma-util
npm i
```

## Building packages when you make changes

We have provided a few scripts for you to run to make it easier when developing for Prisma Util. These can be invoked via NPM.

To compile the code:
```sh
npm run build
```

To compile the code and install the compiled version on your device:
```sh
npm run local
```

## Conventions

### Git Commit Messages

We structure our messages like this:

```
<type>: <subject>
<BLANK LINE>
<body>
```

Example

```
fix: base schema not including generator

Closes #111
```

List of types:

- feat: A new feature
- fix: A bug fix
- docs: Documentation only changes
- style: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- refactor: A code change that neither fixes a bug nor adds a feature
- perf: A code change that improves performance
- test: Adding missing or correcting existing tests
- chore: Changes to the build process or auxiliary tools and libraries such as documentation generation