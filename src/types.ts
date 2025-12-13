export type Maybe<T> = T | undefined | null;

export type Scalar = string | number | boolean | null | undefined | Date;

// utility type to expand complex types for better IDE tooltips
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// utility type to extract keys of properties that can be undefined
export type OptionalKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

// utility type to extract keys of properties that are numbers
export type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

// utility type to extract keys of properties that are Dates
export type DateKeys<T> = {
  [K in keyof T]: T[K] extends Date
    ? K
    : T[K] extends Date | undefined
      ? K
      : never;
}[keyof T] &
  string;

// utility type to extract keys of properties that are objects (not primitives, excluding Date)
export type ObjectKeys<T> = {
  [K in keyof T]: T[K] extends object
    ? T[K] extends Date
      ? never
      : K
    : T[K] extends object | undefined
      ? T[K] extends Date | undefined
        ? never
        : K
      : never;
}[keyof T] &
  string;

// utility type to extract keys of properties that are strings
export type StringKeys<T> = {
  [K in keyof T]: T[K] extends string
    ? K
    : T[K] extends string | undefined
      ? K
      : never;
}[keyof T] &
  string;

// Nested path typing helper (depth-limited recursive)
type Decrease<D> = D extends 4
  ? 3
  : D extends 3
    ? 2
    : D extends 2
      ? 1
      : D extends 1
        ? 0
        : never;

// dotted path to all properties that are optional, e.g. 'a.b.c'
// depth-limited recursive for performance (2 dots)
export type OptionalPropPath<
  T,
  Prefix extends string = '',
  Depth extends number = 2,
> = Depth extends never
  ? never
  : T extends Scalar
    ? never
    : T extends ReadonlyArray<any> | any[]
      ? never
      : T extends { [K in keyof T]: T[K] }
        ? {
            [K in Extract<keyof T, string>]:
              | (undefined extends T[K]
                  ? Prefix extends ''
                    ? K
                    : `${Prefix}.${K}`
                  : never)
              | OptionalPropPath<
                  T[K],
                  Prefix extends '' ? K : `${Prefix}.${K}`,
                  Decrease<Depth>
                >;
          }[Extract<keyof T, string>]
        : never;

// Dotted path to all properties that are of scalar types (depth-limited).
export type ScalarPropPath<
  T,
  Prefix extends string = '',
  Depth extends number = 2,
> = Depth extends never
  ? never
  : T extends Scalar
    ? never
    : T extends ReadonlyArray<any> | any[]
      ? never
      : T extends { [K in keyof T]: T[K] }
        ? {
            [K in Extract<keyof T, string>]:
              | (T[K] extends Scalar
                  ? Prefix extends ''
                    ? K
                    : `${Prefix}.${K}`
                  : never)
              | ScalarPropPath<
                  T[K],
                  Prefix extends '' ? K : `${Prefix}.${K}`,
                  Decrease<Depth>
                >;
          }[Extract<keyof T, string>]
        : never;

// Given a dotted path P, resolve the scalar type at that path in T.
// Assumes P is a valid ScalarPropPath<T>. Uses NonNullable when recursing so
// that we walk the "present" branch of optional properties, while still
// preserving optionality at the leaf via Extract<..., Scalar>.
export type ScalarAtPath<
  T,
  P extends string,
> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof NonNullable<T>
    ? ScalarAtPath<NonNullable<T>[K], Rest>
    : never
  : P extends keyof NonNullable<T>
    ? Extract<NonNullable<T>[P], Scalar>
    : never;
