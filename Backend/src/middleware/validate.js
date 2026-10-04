/**
 * Validates and coerces request parts with zod schemas.
 * Parsed values go to `req.valid` because Express 5 makes `req.query` read-only.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const [part, schema] of Object.entries(schemas)) {
    req.valid[part] = schema.parse(req[part] ?? {});
  }
  next();
};
