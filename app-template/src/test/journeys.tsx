import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { App } from "../App.js";
import { filterToken, type FilterValue } from "../composers/filter.js";

/**
 * Journey helpers for the generated app's product tests.
 *
 * Domain-neutral: every argument is a visible label or a value from the product
 * model, so the same helpers work for any idea. Call `renderApp()` first.
 */

let user: UserEvent | undefined;

function current(): UserEvent {
  if (!user) throw new Error("Call renderApp() before using the journey helpers.");
  return user;
}

/** Render the app fresh and return the bound user-event instance. */
export function renderApp(): UserEvent {
  render(<App />);
  user = userEvent.setup();
  return user;
}

/** The add/edit form. Pass `singular` only when the model has more than one entity. */
function form(singular?: string): HTMLElement {
  const name = singular ? new RegExp(`^(Add|Save) ${singular}$`, "i") : /^(Add|Save) /i;
  const scope = screen.getByRole("button", { name }).closest("form");
  if (!scope) throw new Error("No record form on screen.");
  return scope;
}

async function fill(scope: HTMLElement, fields: Record<string, string>): Promise<void> {
  for (const [label, value] of Object.entries(fields)) {
    const control = within(scope).getByLabelText(label);
    if (control instanceof HTMLSelectElement) {
      await current().selectOptions(control, value);
    } else if (control instanceof HTMLInputElement && control.type === "checkbox") {
      if (control.checked !== (value === "true")) await current().click(control);
    } else {
      await current().clear(control);
      if (value) await current().type(control, value);
    }
  }
}

/** Fill the add form from `{ "Attribute label": "value" }` and submit it. */
export async function addRecord(fields: Record<string, string>, singular?: string): Promise<void> {
  const scope = form(singular);
  await fill(scope, fields);
  await current().click(within(scope).getByRole("button", { name: /^Add /i }));
}

/** The table row containing `text`. Throws with a readable message when absent. */
export function rowFor(text: string): HTMLElement {
  const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByText(text) !== null);
  if (!row) throw new Error(`No row containing ${JSON.stringify(text)}.`);
  return row;
}

/** Open the row's edit form, apply `fields`, and save. */
export async function editRecord(
  rowText: string,
  fields: Record<string, string>,
  singular?: string,
): Promise<void> {
  await current().click(within(rowFor(rowText)).getByRole("button", { name: /^Edit /i }));
  const scope = form(singular);
  await fill(scope, fields);
  await current().click(within(scope).getByRole("button", { name: /^Save /i }));
}

/** Delete the row containing `rowText`. The undo affordance stays on screen. */
export async function removeRecord(rowText: string): Promise<void> {
  await current().click(within(rowFor(rowText)).getByRole("button", { name: /^Remove /i }));
}

/** Click the Undo button offered after a delete. */
export async function undoRemove(): Promise<void> {
  await current().click(within(screen.getByRole("status")).getByRole("button", { name: /^Undo$/i }));
}

/** The value shown by a `derived` entry, found by its model label. */
export function derivedValue(label: string): string {
  const stat = screen.getByText(label).closest("p");
  return stat?.querySelector("strong")?.textContent ?? "";
}

/**
 * Narrow the collection. Pass the same shape the model declares, e.g.
 * `{ attribute: "borrower", present: true }` or `{ attribute: "kind", equals: "Novel" }`.
 * Pass `null` to clear. Never build the option string by hand.
 */
export async function filterBy(filter: FilterValue, plural?: string): Promise<void> {
  const name = plural ? new RegExp(`^Show ${plural}$`, "i") : /^Show /i;
  await current().selectOptions(screen.getByRole("combobox", { name }), filterToken(filter));
}

/** Remount the app from persisted storage, then run `assert`. */
export async function expectSurvivesRefresh(assert: () => void | Promise<void>): Promise<void> {
  cleanup();
  renderApp();
  await assert();
}
