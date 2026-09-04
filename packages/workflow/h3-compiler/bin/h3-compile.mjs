#!/usr/bin/env node
import { main } from "./h3-compiler.mjs";

process.exitCode = await main();
