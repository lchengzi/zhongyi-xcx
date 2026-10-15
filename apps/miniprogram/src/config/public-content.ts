import { publicContentOrigin } from '@food-education/catalog-core';

declare const __FOOD_EDUCATION_PUBLIC_ORIGIN__: unknown;

/** Deployment-owned build constant. Default is null; configuration is never
 * learned from a response, local storage, user input or an environment dump. */
export const publicContentConfig: Readonly<{ origin: string | null }> = Object.freeze({
  origin: publicContentOrigin(__FOOD_EDUCATION_PUBLIC_ORIGIN__)
});
