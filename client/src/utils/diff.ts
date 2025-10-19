import { createTwoFilesPatch } from "diff";

export function difference(a: string, b: string): string {
  return createTwoFilesPatch("selected", "current", a, b, undefined, undefined, {
    context: 3,
  });
}
