// bad-trigger.ts — deliberate type errors to test the LSP proxy.
const n: number = "not a number";
const arr: number[] = ["one", 2, "three"];
function total(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}
const result: string = total(arr) + true;