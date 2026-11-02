// Minimal JSON Schema checker for our own schemas (type, enum, required,
// properties, additionalProperties:false, items, minItems). Zero dependencies.
// Returns a list of problems; an empty list means valid. Callers fail loudly
// on any problem rather than repairing the data.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matchesType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number' && Number.isFinite(v));

export function validate(value, schema, path = '$') {
  const problems = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      problems.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return problems;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) problems.push(`${path}: missing required field "${key}"`);
    }
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) problems.push(...validate(v, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected field "${key}"`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      problems.push(`${path}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) value.forEach((item, i) => problems.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  return problems;
}

/** Throw a readable error if `value` doesn't match `schema`. */
export function assertValid(value, schema, label) {
  const problems = validate(value, schema);
  if (problems.length) {
    throw new Error(`${label} failed the schema check:\n  - ${problems.slice(0, 20).join('\n  - ')}${problems.length > 20 ? `\n  …and ${problems.length - 20} more` : ''}`);
  }
  return value;
}
