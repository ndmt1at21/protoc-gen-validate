import { getExtension, hasExtension } from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, } from "@bufbuild/protoplugin";
import { localName, type Schema } from "@bufbuild/protoplugin/ecmascript";
import { FieldRules, rules } from "./proto/validate_pb";

export const protocGenValidate = createEcmaScriptPlugin({
  name: "protoc-gen-validate",
  version: `v1`,
  generateTs,
});

const relativePathRE = /^\.{1,2}\//;

const MAX_INT32 = 2147483647;
const MIN_INT32 = -2147483648;

const MAX_INT64 = BigInt("9223372036854775807");
const MIN_INT64 = BigInt("-9223372036854775808");

const MAX_UINT32 = 4294967295;
const MIN_UINT32 = 0;

const MAX_UINT64 = BigInt("18446744073709551615");
const MIN_UINT64 = BigInt("0");

const MAX_FLOAT = 3.4028234663852886e38;
const MIN_FLOAT = -3.4028234663852886e38;

const MAX_DOUBLE = Number.MAX_VALUE;
const MIN_DOUBLE = Number.MIN_VALUE;

const DURATION_MAX_SECONDS = BigInt("315576000000");
const DURATION_MIN_SECONDS = BigInt("-315576000000");

const DURATION_MAX_NANOS = 999999999;
const DURATION_MIN_NANOS = -999999999;

// Timestamp for "9999-12-31T23:59:59Z"
const TIMESTAMP_MAX_SECONDS = BigInt("253402300799");

// Timestamp for "0001-01-01T00:00:00Z"
const TIMESTAMP_MIN_SECONDS = BigInt("-62135596800");

const NANO_PER_SECOND = 1000000000;

function generateTs(schema: Schema) {
  for (const file of schema.files) {
    const f = schema.generateFile(file.name + "_validate.ts");
    f.preamble(file)
    f.print("import { z, ZodError } from 'zod';");
    f.print("import { Duration, Timestamp, PlainMessage } from '@bufbuild/protobuf';\n");

    f.print(
      f.exportDecl(
        "type",
        `ValidationErrorIssue = { \n\tfield: string,\n\tmessage: string\n}\n`
      )
    );
    f.print(
      f.exportDecl(
        "class",
        `ValidationError extends Error {\n\tissues: ValidationErrorIssue[]\n`
      )
    );
    f.print("  constructor(issues: ValidationErrorIssue[]) {");
    f.print("    super();");
    f.print("    this.issues = issues");
    f.print("  }");
    f.print("}");
    
    
    for (const message of file.messages) {
      const importMessage = f.import(message);
      f.print('const _ = new ', importMessage, '()\n')
  
      f.print(f.jsDoc(message));
      
      f.print(`declare module "${makeImportPathRelative(file.name + "_validate.js", importMessage.from)}" {`)
      f.print(f.exportDecl("  interface ", localName(message)), " {");
      f.print("    validate(request: ", importMessage, " | PlainMessage<", importMessage, ">", "): void");
      f.print("  }");
      f.print("}");

      f.print(importMessage, ".prototype.validate = function(request: ", importMessage, " | PlainMessage<", importMessage, ">", ") {");
      
      const schemaName = `${localName(message)}Schema`;
      let validateTemplate = `  const ${schemaName} = z.object({\n`;

      for (const field of message.fields) {
        if (field.proto.options && hasExtension(field.proto.options, rules)) {
          const rule = getExtension(field.proto.options, rules);
          validateTemplate += `      ${
            field.proto.name
          }: z${getValidateTemplate(rule)},\n`;
        }
      }

      validateTemplate += `  })\n`;

      f.print(validateTemplate);
      f.print("  try {");
      f.print(`    ${schemaName}.parse(request)`);
      f.print("  } catch (error) {");
      f.print("    if (error instanceof ZodError) {");
      f.print(
        "      const issues: ValidationErrorIssue[] = error.issues.map((issue) => ({"
      );
      f.print("        field: issue.path.join('.'),");
      f.print("        message: issue.message,");
      f.print("      }))");
      f.print("      throw new ValidationError(issues)");
      f.print("    }");
      f.print("  }");
      f.print("}");
    }
  }
}

export function makeImportPathRelative(
  importer: string,
  importPath: string,
): string {
  if (!relativePathRE.test(importPath)) {
    // We don't touch absolute imports, like @bufbuild/protobuf
    return importPath;
  }
  let a = importer
    .replace(/^\.\//, "")
    .split("/")
    .filter((p) => p.length > 0)
    .slice(0, -1);
  let b = importPath
    .replace(/^\.\//, "")
    .split("/")
    .filter((p) => p.length > 0);
  let matchingPartCount = 0;
  for (
    let l = Math.min(a.length, b.length);
    matchingPartCount < l;
    matchingPartCount++
  ) {
    if (a[matchingPartCount] !== b[matchingPartCount]) {
      break;
    }
  }
  a = a.slice(matchingPartCount);
  b = b.slice(matchingPartCount);
  const c = a
    .map(() => "..")
    .concat(b)
    .join("/");
  return relativePathRE.test(c) ? c : "./" + c;
}

function getValidateTemplate(rule: FieldRules): string {
  let t: string = "";

  switch (rule.type.case) {
    case "string":
      t = getValidateStringTemplate(rule);
      break;
    case "int32":
    case "sint32":
    case "sfixed32":
      t = getInt32ValidateTemplate(rule);
      break;
    case "int64":
    case "sint64":
    case "sfixed64":
      t = getInt64ValidateTemplate(rule);
      break;
    case "float":
      t = getFloatValidateTemplate(rule);
      break;
    case "double":
      t = getDoubleValidateTemplate(rule);
      break;
    case "uint32":
    case "fixed32":
      t = getUInt32ValidateTemplate(rule);
      break;
    case "uint64":
    case "fixed64":
      t = getUInt64ValidateTemplate(rule);
      break;
    case "bool":
      t = getBoolValidateTemplate(rule);
      break;
    case "any":
      t = getValidateAnyTemplate(rule);
      break;
    case "bytes":
      t = getValidateBytesTemplate(rule);
      break;
    case "duration":
      t = getValidateDurationTemplate(rule);
      break;
    case "timestamp":
      t = getValidateTimestampTemplate(rule);
      break;
    case "repeated":
      t = getRepeatedValidateTemplate(rule);
      break;
    default:
      break;
  }

  return t;
}
function getValidateStringTemplate(rule: FieldRules): string {
  if (rule.type.case != "string") {
    return "";
  }

  const ruleValue = rule.type.value;
  if (ruleValue.ignoreEmpty) {
    return "";
  }

  let template = `.string()`;

  if (ruleValue.minLen) {
    template += `.min(${ruleValue.minLen})`;
  }

  if (ruleValue.maxLen) {
    template += `.max(${ruleValue.maxLen})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.len) {
    template += `.length(${ruleValue.len})`;
  }

  if (ruleValue.lenBytes) {
    template += `.length(${ruleValue.lenBytes})`;
  }

  if (ruleValue.maxBytes) {
    template += `.max(${ruleValue.maxBytes})`;
  }

  if (ruleValue.minBytes) {
    template += `.min(${ruleValue.minBytes})`;
  }

  if (ruleValue.pattern) {
    template += `.refine((value) => new RegExp(${ruleValue.pattern}).test(value), {
          message: "Value must match pattern ${ruleValue.pattern}",
        })`;
  }

  if (ruleValue.suffix) {
    template += `.refine((value) => value.endsWith(${ruleValue.suffix}), {
          message: "Value must end with ${ruleValue.suffix}",
        })`;
  }

  if (ruleValue.prefix) {
    template += `.refine((value) => value.startsWith(${ruleValue.prefix}), {
          message: "Value must start with ${ruleValue.prefix}",
        })`;
  }

  if (ruleValue.notContains) {
    template += `.refine((value) => value.includes(${ruleValue.notContains}), {
          message: "Value must not contain ${ruleValue.notContains}",
        })`;
  }

  if (ruleValue.contains) {
    template += `.refine((value) => value.includes(${ruleValue.contains}), {
          message: "Value must contain ${ruleValue.contains}",
        })`;
  }

  if (ruleValue.wellKnown) {
    const wellKnownCase = ruleValue.wellKnown.case;
    const wellKnownValue = ruleValue.wellKnown.value;

    if (wellKnownCase === "email" && wellKnownValue) {
      template += `.email()`;
    }

    if (wellKnownCase === "hostname" && wellKnownValue) {
      // template += `.hostname()`
    }

    if (wellKnownCase === "ipv4" && wellKnownValue) {
      template += `.ip({version: 'v4'})`;
    }

    if (wellKnownCase === "ipv6" && wellKnownValue) {
      template += `.ip({version: 'v6'})`;
    }

    if (wellKnownCase === "uri" && wellKnownValue) {
      // template += `.url()`
    }

    if (wellKnownCase === "uuid" && wellKnownValue) {
      template += `.uuid()`;
    }

    if (wellKnownCase === "uriRef" && wellKnownValue) {
      // template += `.url()`
    }
  }

  return template;
}

function getInt32ValidateTemplate(rule: FieldRules): string {
  if (
    rule.type.case != "int32" &&
    rule.type.case != "sint32" &&
    rule.type.case != "sfixed32"
  ) {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.number().int()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in int32 range
  template += `.refine((value) => value < ${MAX_INT32}, {
        message: "Value must be less than ${MAX_INT32}",
      })`;
  template += `.refine((value) => value > ${MIN_INT32}, {
        message: "Value must be greater than ${MIN_INT32}",
      })`;

  return template;
}

function getInt64ValidateTemplate(rule: FieldRules): string {
  if (
    rule.type.case != "int64" &&
    rule.type.case != "sint64" &&
    rule.type.case != "sfixed64"
  ) {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.bigint()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in int64 range
  template += `.refine((value) => value < ${MAX_INT64}, {
        message: "Value must be less than ${MAX_INT64}",
      })`;
  template += `.refine((value) => value > ${MIN_INT64}, {
        message: "Value must be greater than ${MIN_INT64}",
      })`;

  return template;
}

function getFloatValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "float") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.number()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in float range
  template += `.refine((value) => value < ${MAX_FLOAT}, {
        message: "Value must be less than ${MAX_FLOAT}",
      }).refine((value) => value > ${MIN_FLOAT}, {
        message: "Value must be greater than ${MIN_FLOAT}",
      })`;

  return template;
}

function getDoubleValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "double") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.number()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in double range
  template += `.refine((value) => value < ${MAX_DOUBLE}, {
        message: "Value must be less than ${MAX_DOUBLE}",
      }).refine((value) => value > ${MIN_DOUBLE}, {
        message: "Value must be greater than ${MIN_DOUBLE}",
      })`;

  return template;
}

function getUInt32ValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "uint32" && rule.type.case != "fixed32") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.number().int()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in uint32 range
  template += `.refine((value) => value < ${MAX_UINT32}, {
        message: "Value must be less than ${MAX_UINT32}",
      }).refine((value) => value > ${MIN_UINT32}, {
        message: "Value must be greater than ${MIN_UINT32}",
      })`;

  return template;
}

function getUInt64ValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "uint64" && rule.type.case != "fixed64") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.bigint()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.lt) {
    template += `.lt(${ruleValue.lt})`;
  }

  if (ruleValue.lte) {
    template += `.lte(${ruleValue.lte})`;
  }

  if (ruleValue.gt) {
    template += `.gt(${ruleValue.gt})`;
  }

  if (ruleValue.gte) {
    template += `.gte(${ruleValue.gte})`;
  }

  if (ruleValue.in.length > 0) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length > 0) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  // Validate min and max is in uint64 range
  template += `.refine((value) => value < ${MAX_UINT64}, {
        message: "Value must be less than ${MAX_UINT64}",
      })`;
  template += `.refine((value) => value > ${MIN_UINT64}, {
        message: "Value must be greater than ${MIN_UINT64}",
      })`;

  return template;
}

function getBoolValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "bool") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `z.boolean()`;

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  return template;
}

function getRepeatedValidateTemplate(rule: FieldRules): string {
  if (rule.type.case != "repeated") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.array()`;

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.minItems) {
    template += `.min(${ruleValue.minItems})`;
  }

  if (ruleValue.maxItems) {
    template += `.max(${ruleValue.maxItems})`;
  }

  if (ruleValue.unique) {
    template += `.refine((value) => new Set(value).size === value.length, {
          message: "Value must be unique",
        })`;
  }

  if (ruleValue.items) {
    template += getValidateTemplate(ruleValue.items);
  }

  return template;
}

function getValidateAnyTemplate(rule: FieldRules): string {
  if (rule.type.case != "any") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.any()`;

  if (ruleValue.required && !ruleValue.required) {
    template += `.optional()`;
  }

  if (ruleValue.in.length) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  return template;
}

function getValidateBytesTemplate(rule: FieldRules) {
  if (rule.type.case != "bytes") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = ".array()";

  if (ruleValue.ignoreEmpty) {
    return "";
  }

  if (ruleValue.len) {
    template += `.length(${ruleValue.len})`;
  }

  if (ruleValue.minLen) {
    template += `.min(${ruleValue.minLen})`;
  }

  if (ruleValue.maxLen) {
    template += `.max(${ruleValue.maxLen})`;
  }

  if (ruleValue.in.length) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value === ${ruleValue.const}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  if (ruleValue.prefix) {
    template += `.refine((value) => value.startsWith(${ruleValue.prefix}), {
          message: "Value must start with ${ruleValue.prefix}",
        })`;
  }

  if (ruleValue.suffix) {
    template += `.refine((value) => value.endsWith(${ruleValue.suffix}), {
          message: "Value must end with ${ruleValue.suffix}",
        })`;
  }

  if (ruleValue.wellKnown.case === "ip" && ruleValue.wellKnown.value) {
    template += ".ip()";
  }

  if (ruleValue.wellKnown.case === "ipv4" && ruleValue.wellKnown.value) {
    template += ".ip({version: 'v4'})";
  }

  if (ruleValue.wellKnown.case === "ipv6" && ruleValue.wellKnown.value) {
    template += ".ip({version: 'v6'})";
  }

  return template;
}

function getValidateDurationTemplate(rule: FieldRules): string {
  if (rule.type.case != "duration") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.object({ 
        seconds: z.bigint(),
        nanos: z.number().int()
      })`;

  if (ruleValue.required && !ruleValue.required) {
    template += `.optional()`;
  }

  if (ruleValue.const) {
    template += `.refine((value) => value.nanos === ${ruleValue.const.nanos} && value.seconds === ${ruleValue.const.seconds}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  if (ruleValue.lt) {
    template += `.refine((value) => value.seconds < ${ruleValue.lt.seconds} && value.nanos < ${ruleValue.lt.nanos}, {
          message: "Value must be less than { seconds: ${ruleValue.lt.seconds}, nanos: ${ruleValue.lt.nanos} }",
        })`;
  }

  if (ruleValue.lte) {
    template += `.refine((value) => value.seconds <= ${ruleValue.lte.seconds} && value.nanos <= ${ruleValue.lte.nanos}, {
          message: "Value must be less than or equal to { seconds: ${ruleValue.lte.seconds}, nanos: ${ruleValue.lte.nanos} }",
        })`;
  }

  if (ruleValue.gt) {
    template += `.refine((value) => value.seconds > ${ruleValue.gt.seconds} && value.nanos > ${ruleValue.gt.nanos}, {
          message: "Value must be greater than { seconds: ${ruleValue.gt.seconds}, nanos: ${ruleValue.gt.nanos} }",
        })`;
  }

  if (ruleValue.gte) {
    template += `.refine((value) => value.seconds >= ${ruleValue.gte.seconds} && value.nanos >= ${ruleValue.gte.nanos}, {
          message: "Value must be greater than or equal to { seconds: ${ruleValue.gte.seconds}, nanos: ${ruleValue.gte.nanos} }",
        })`;
  }

  if (ruleValue.in.length) {
    template += `.refine((value) => ${ruleValue.in}.includes(value), {
          message: "Value must be one of ${ruleValue.in.join(", ")}",
        })`;
  }

  if (ruleValue.notIn.length) {
    template += `.refine((value) => ${ruleValue.notIn}.includes(value), {
          message: "Value must not be one of ${ruleValue.notIn.join(", ")}",
        })`;
  }

  // Validate min and max is in duration range
  template += `.refine((value) => value.nanos < ${DURATION_MAX_NANOS}, {
        message: "Nanos value must be less than ${DURATION_MAX_NANOS}",
      }).refine((value) => value.nanos > ${DURATION_MIN_NANOS}, {
        message: "Nanos value must be greater than ${DURATION_MIN_NANOS}",
      }).refine((value) => value.seconds < ${DURATION_MAX_SECONDS}, {
        message: "Seconds value must be less than ${DURATION_MAX_SECONDS}",
      }).refine((value) => value.seconds > ${DURATION_MIN_SECONDS}, {
        message: "Seconds value must be greater than ${DURATION_MIN_SECONDS}",
      })`;

  return template;
}

function getValidateTimestampTemplate(rule: FieldRules): string {
  if (rule.type.case !== "timestamp") {
    return "";
  }

  const ruleValue = rule.type.value;
  let template = `.object({
        seconds: z.bigint(),
        nanos: z.number().int(),
      })`;

  if (ruleValue.required && !ruleValue.required) {
    return ".optional()";
  }

  if (ruleValue.const) {
    template += `.refine((value) => value.seconds === ${ruleValue.const.seconds} && value.nanos === ${ruleValue.const.nanos}, {
          message: "Value must be ${ruleValue.const}",
        })`;
  }

  if (ruleValue.lt) {
    template += `.refine((value) => {
          if (value.seconds < ${ruleValue.lt.seconds}) {
            return true;
          }
          if (value.seconds === ${ruleValue.lt.seconds} && value.nanos < ${ruleValue.lt.nanos}) {
            return true;
          }
          return false;
        }, {
          message: "Value must be less than { seconds: ${ruleValue.lt.seconds}, nanos: ${ruleValue.lt.nanos} }",
        })`;
  }

  if (ruleValue.lte) {
    template += `.refine((value) => {
          if (value.seconds < ${ruleValue.lte.seconds}) {
            return true;
          }
          if (value.seconds === ${ruleValue.lte.seconds} && value.nanos <= ${ruleValue.lte.nanos}) {
            return true;
          }
          return false;
        }
        , {
          message: "Value must be less than or equal to { seconds: ${ruleValue.lte.seconds}, nanos: ${ruleValue.lte.nanos} }",
        })`;
  }

  if (ruleValue.gt) {
    template += `.refine((value) => {
          if (value.seconds > ${ruleValue.gt.seconds}) {
            return true;
          }
          if (value.seconds === ${ruleValue.gt.seconds} && value.nanos > ${ruleValue.gt.nanos}) {
            return true;
          }
          return false;
        }, {
          message: "Value must be greater than { seconds: ${ruleValue.gt.seconds}, nanos: ${ruleValue.gt.nanos} }",
        })`;
  }

  if (ruleValue.gte) {
    template += `.refine((value) => {
          if (value.seconds > ${ruleValue.gte.seconds}) {
            return true;
          }
          if (value.seconds === ${ruleValue.gte.seconds} && value.nanos >= ${ruleValue.gte.nanos}) {
            return true;
          }
          return false;
        }, {
          message: "Value must be greater than or equal to { seconds: ${ruleValue.gte.seconds}, nanos: ${ruleValue.gte.nanos} }",
        })`;
  }

  if (ruleValue.gtNow) {
    template += `.refine((value) => {
          const timeNow = Timestamp.now()
          if (value.seconds > timeNow.seconds) {
            return true;
          }
          if (value.seconds === timeNow.seconds && value.nanos > timeNow.nanos) {
            return true;
          }
          return false;
        }, {
          message: "Value must be greater than now timestamp",
        })`;
  }

  if (ruleValue.ltNow) {
    template += `.refine((value) => {
          const timeNow = Timestamp.now()
          if (value.seconds < timeNow.seconds) {
            return true;
          }
          if (value.seconds === timeNow.seconds && value.nanos < timeNow.nanos) {
            return true;
          }
          return false;
        }, {
          message: "Value must be less than now timestamp",
        })`;
  }

  if (ruleValue.within) {
    template += `.refine((value) => {
          const timeNow = Timestamp.now()
          const timeDiff = timeNow.seconds - value.seconds
          if (timeDiff < ${ruleValue.within.seconds}) {
            return true;
          }
          if (timeDiff === ${ruleValue.within.seconds} && timeNow.nanos - value.nanos < ${ruleValue.within.nanos}) {
            return true;
          }
          return false;
        }, {
          message: "Value must be within { seconds: ${ruleValue.within.seconds}, nanos: ${ruleValue.within.nanos} } from now",
        })`;
  }

  // Validate min and max is in timestamp range
  template += `.refine((value) => value.nanos >= 0, {
        message: "Nanos value must be greater than 0",
      }).refine((value) => value.nanos < ${NANO_PER_SECOND}, {
        message: "Nanos value must be less than ${NANO_PER_SECOND}",
      }).refine((value) => value.seconds < ${TIMESTAMP_MAX_SECONDS}, {
        message: "Seconds value must be less than ${TIMESTAMP_MAX_SECONDS}",
      }).refine((value) => value.seconds > ${TIMESTAMP_MIN_SECONDS}, {
        message: "Seconds value must be greater than ${TIMESTAMP_MIN_SECONDS}",
      })`;

  return template;
}
