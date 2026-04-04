import binaryen from "../binaryen.base.js";

const OriginalModule = binaryen.Module;
const originalWrapModule = binaryen.wrapModule;
const originalParseText = binaryen.parseText;
const originalReadBinary = binaryen.readBinary;
const ANNOTATION_NAME = "@metadata.code.branch_hint";

function normalizeBranchHints(hints) {
  if (hints instanceof Map) {
    return new Map([...hints.entries()].map(([name, values]) => [toWatFunctionName(name), values]));
  }
  if (typeof hints?.forEach === "function" && hints.constructor !== Object) {
    const normalized = new Map();
    hints.forEach((values, name) => {
      normalized.set(toWatFunctionName(name), values);
    });
    return normalized;
  }
  return new Map(
    Object.entries(hints).map(([name, values]) => [toWatFunctionName(name), values]),
  );
}

function toWatFunctionName(name) {
  return name.startsWith("$") ? name : `$${name}`;
}

function countParensDelta(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === "(") delta++;
    else if (ch === ")") delta--;
  }
  return delta;
}

function matchFunctionName(line) {
  const match = line.match(/^\(func(?:\s+(\$[^\s()]+))?/);
  return match?.[1] ?? null;
}

function isHintableInstruction(line) {
  return line.startsWith("(if") || line.startsWith("(br_if ");
}

function encodeHintValue(value) {
  return value === true || value === 1 ? "\\01" : "\\00";
}

function annotateModuleText(text, branchHints) {
  const hintsByFunction = normalizeBranchHints(branchHints);
  const lines = text.split("\n");
  const annotated = [];
  let currentFunctionName = null;
  let currentHints = null;
  let hintIndex = 0;
  let depth = 0;
  let functionDepth = 0;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (currentFunctionName == null) {
      const funcName = matchFunctionName(trimmed);
      if (funcName) {
        currentFunctionName = funcName;
        currentHints = hintsByFunction.get(funcName) ?? null;
        hintIndex = 0;
        functionDepth = depth;
      }
    }

    if (currentHints && hintIndex < currentHints.length && isHintableInstruction(trimmed)) {
      annotated.push(
        `${line.slice(0, line.length - trimmed.length)}(${ANNOTATION_NAME} "${encodeHintValue(currentHints[hintIndex])}")`,
      );
      hintIndex++;
      changed = true;
    }

    annotated.push(line);
    depth += countParensDelta(line);

    if (currentFunctionName != null && depth <= functionDepth) {
      currentFunctionName = null;
      currentHints = null;
      hintIndex = 0;
    }
  }

  return changed ? annotated.join("\n") : text;
}

function addBranchHints(module, branchHints) {
  const text = module.emitText();
  const annotatedText = annotateModuleText(text, branchHints);
  if (annotatedText === text) {
    return module;
  }
  return attachBranchHintHelpers(binaryen.parseText(annotatedText));
}

function attachBranchHintHelpers(module) {
  if (typeof module.addBranchHints === "function") {
    return module;
  }
  module.addBranchHints = function(branchHints) {
    return addBranchHints(module, branchHints);
  };
  return module;
}

binaryen.addBranchHints = addBranchHints;
binaryen.Module = function(...args) {
  return attachBranchHintHelpers(new OriginalModule(...args));
};
binaryen.Module.prototype = OriginalModule.prototype;
binaryen.wrapModule = function(ptr) {
  return attachBranchHintHelpers(originalWrapModule(ptr));
};
binaryen.parseText = function(text) {
  return attachBranchHintHelpers(originalParseText(text));
};
binaryen.readBinary = function(data) {
  return attachBranchHintHelpers(originalReadBinary(data));
};

export default binaryen;
