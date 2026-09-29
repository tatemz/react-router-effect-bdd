import { Config, Schema } from "effect";

/**
 * The closed set of ways the app runs: a production Next server, or a
 * development one with on-demand compilation and HMR.
 *
 * A frozen object plus its value union - the enum pattern Node's
 * strip-only TypeScript accepts (a real `enum` is a runtime construct and
 * `node file.ts` will not evaluate one). Call sites still name
 * `Mode.Production` instead of repeating a string literal, and the
 * `production` lane of the BDD Examples table decodes through `ModeSchema`
 * into this exact set.
 *
 * @example
 * import { Mode } from "./config.ts";
 *
 * Mode.Production; // "production"
 * Mode.Development; // "development"
 */
export const Mode = {
  Production: "production",
  Development: "development",
} as const;
export type Mode = typeof Mode[keyof typeof Mode];

/**
 * The closed set of languages the Greeter speaks.
 *
 * Same enum-object pattern as {@link Mode}: `Language.English` is the one
 * spelling of `"en"` the codebase uses.
 *
 * @example
 * import { Language } from "./config.ts";
 *
 * Language.English; // "en"
 * Language.Spanish; // "es"
 */
export const Language = {
  English: "en",
  Spanish: "es",
} as const;
export type Language = typeof Language[keyof typeof Language];

/**
 * The schema for {@link Mode}: decodes the exact Gherkin/ENV strings
 * `"production"` and `"development"` into the enum.
 *
 * The type annotation is deliberate: without it `Schema.Enum` infers the
 * whole object type, which widens `ModeSchema.Type` past the union of
 * values.
 *
 * @example
 * import { ModeSchema } from "./config.ts";
 *
 * ModeSchema.decodeUnknownSync("development"); // Mode.Development
 * // ModeSchema.decodeUnknownSync("staging"); // throws: expected "production" | "development"
 */
export const ModeSchema: Schema.Enum<typeof Mode> = Schema.Enum(Mode);

/**
 * The schema for {@link Language}: decodes `"en"`/`"es"` into the enum.
 *
 * @example
 * import { LanguageSchema } from "./config.ts";
 *
 * LanguageSchema.decodeUnknownSync("es"); // Language.Spanish
 */
export const LanguageSchema: Schema.Enum<typeof Language> = Schema.Enum(Language);

/**
 * Required runtime configuration of the standalone app: the mode, the
 * greeter for page renders, and the port. Nothing is defaulted; invalid
 * values fail at startup with a typed `ConfigError`.
 *
 * This is the single source of truth every entry point (`main.ts`,
 * `main.rr.ts`) and the BDD runner read from the environment.
 *
 * @example
 * import { Effect } from "effect";
 * import { AppConfig } from "./config.ts";
 *
 * // With PORT=3456 LANGUAGE=en MODE=development in the environment:
 * Effect.runSync(AppConfig); // { mode: Mode.Development, language: Language.English, port: 3456 }
 */
export const AppConfig = Config.all({
  mode: Config.schema(ModeSchema, "MODE"),
  language: Config.schema(LanguageSchema, "LANGUAGE"),
  port: Config.Port("PORT"),
});
