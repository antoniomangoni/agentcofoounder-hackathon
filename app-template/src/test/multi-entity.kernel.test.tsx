import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// No generated model has ever had more than one entity, so the binder's per-entity
// fan-out (a form, a collection and a filter bar each) and the singular/plural
// disambiguation parameters on the journey helpers are otherwise unexercised.
vi.mock("../product-model.json", () => ({
  default: {
    title: "Workshop",
    entities: [
      {
        id: "project",
        singular: "project",
        plural: "projects",
        attributes: [
          { id: "name", label: "Project name", kind: "text", required: true },
          { id: "client", label: "Client", kind: "text", required: false },
        ],
      },
      {
        id: "task",
        singular: "task",
        plural: "tasks",
        attributes: [
          { id: "title", label: "Task title", kind: "text", required: true },
          { id: "done", label: "Done", kind: "boolean", required: false },
        ],
      },
    ],
    links: [],
    journeys: [
      { kind: "add", journey: "Add" },
      { kind: "edit", journey: "Edit" },
      { kind: "delete", journey: "Remove" },
      { kind: "filter", journey: "Filter" },
      { kind: "derive", journey: "Counts" },
      { kind: "persist", journey: "Persist" },
    ],
    derived: [
      { id: "open", label: "Open tasks", kind: "count-nodes-where", entity: "task", where: { attribute: "done", present: false } },
      { id: "projects", label: "Projects", kind: "count-nodes", entity: "project" },
    ],
    assumptions: [],
  },
}));

const { renderApp, addRecord, editRecord, removeRecord, rowFor, derivedValue, filterBy, expectSurvivesRefresh } =
  await import("./journeys.js");

describe("multi-entity binder", () => {
  it("mounts a form and a collection per entity", () => {
    renderApp();
    expect(screen.getByRole("button", { name: "Add project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add task" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "tasks" })).toBeInTheDocument();
  });

  it("requires the singular to disambiguate the form", async () => {
    renderApp();
    await expect(addRecord({ "Project name": "Kitchen" })).rejects.toThrow(/multiple elements/i);
  });

  it("adds to each entity independently", async () => {
    renderApp();
    await addRecord({ "Project name": "Kitchen", Client: "Ada" }, "project");
    await addRecord({ "Task title": "Sand the floor" }, "task");
    expect(rowFor("Kitchen")).toBeTruthy();
    expect(rowFor("Sand the floor")).toBeTruthy();
    expect(derivedValue("Projects")).toBe("1");
  });

  it("edits and removes the right entity", async () => {
    renderApp();
    await addRecord({ "Project name": "Kitchen" }, "project");
    await addRecord({ "Task title": "Sand the floor" }, "task");
    await editRecord("Kitchen", { "Project name": "Bathroom" }, "project");
    expect(rowFor("Bathroom")).toBeTruthy();
    expect(rowFor("Sand the floor")).toBeTruthy();
    await removeRecord("Sand the floor");
    expect(screen.queryByText("Sand the floor")).not.toBeInTheDocument();
    expect(rowFor("Bathroom")).toBeTruthy();
  });

  it("filters one entity without touching the other", async () => {
    renderApp();
    await addRecord({ "Project name": "Kitchen" }, "project");
    await addRecord({ "Task title": "Sand the floor", Done: "true" }, "task");
    await addRecord({ "Task title": "Paint" }, "task");
    await filterBy({ attribute: "done", equals: "true" }, "tasks");
    expect(rowFor("Sand the floor")).toBeTruthy();
    expect(screen.queryByText("Paint")).not.toBeInTheDocument();
    expect(rowFor("Kitchen")).toBeTruthy();
  });

  it("persists both entities across a refresh", async () => {
    renderApp();
    await addRecord({ "Project name": "Kitchen" }, "project");
    await addRecord({ "Task title": "Paint" }, "task");
    await expectSurvivesRefresh(() => {
      expect(rowFor("Kitchen")).toBeTruthy();
      expect(rowFor("Paint")).toBeTruthy();
    });
  });
});
