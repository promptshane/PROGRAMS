import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSTELLATION_CATEGORIES,
  CONSTELLATION_SPHERE_RADIUS,
  createFakeConstellationGraph,
} from "../src/renderer/src/lib/constellation-graph.ts";
import {
  DEFAULT_CONSTELLATION_ROTATION,
  focusRotationForPoint,
  getConstellationBackTarget,
  getConstellationColoredNodeIds,
  getConstellationLabelIds,
  getConstellationWheelYawDelta,
  isConstellationCategoryDescendantHighlighted,
  projectConstellationPoint,
  resolveConstellationInteractionTarget,
  rotateConstellationPointAroundAxis,
  rotateConstellationVector,
} from "../src/renderer/src/lib/constellation-3d.ts";

test("fake constellation generation is deterministic", () => {
  assert.deepEqual(
    createFakeConstellationGraph("same-seed"),
    createFakeConstellationGraph("same-seed"),
  );
  assert.notDeepEqual(
    createFakeConstellationGraph("same-seed"),
    createFakeConstellationGraph("different-seed"),
  );
});

test("fake constellation has one center, every category, and seven projects per category", () => {
  const graph = createFakeConstellationGraph();

  assert.equal(graph.nodes.filter((node) => node.kind === "self").length, 1);
  assert.equal(
    graph.nodes.filter((node) => node.kind === "category").length,
    CONSTELLATION_CATEGORIES.length,
  );
  assert.equal(
    new Set(CONSTELLATION_CATEGORIES.map((category) => category.color)).size,
    CONSTELLATION_CATEGORIES.length,
  );
  assert.equal(
    new Set(CONSTELLATION_CATEGORIES.map((category) => category.glow)).size,
    CONSTELLATION_CATEGORIES.length,
  );

  for (const category of CONSTELLATION_CATEGORIES) {
    const projects = graph.nodes.filter(
      (node) => node.kind === "project" && node.categoryId === category.id,
    );
    assert.equal(projects.length, 7);

    for (const project of projects) {
      const systems = graph.nodes.filter(
        (node) => node.kind === "system" && node.parentId === project.id,
      );
      assert.ok(systems.length >= 10);
      assert.ok(systems.length <= 14);
    }
  }
});

test("fake constellation ids and edges are valid", () => {
  const graph = createFakeConstellationGraph();
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));

  assert.equal(nodeIds.size, graph.nodes.length);
  assert.equal(edgeIds.size, graph.edges.length);
  assert.ok(graph.edges.some((edge) => edge.kind === "dependency"));
  assert.ok(graph.edges.some((edge) => edge.kind === "cross-project"));

  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.source));
    assert.ok(nodeIds.has(edge.target));
    assert.notEqual(edge.source, edge.target);
    assert.ok(edge.strength >= 0.18 && edge.strength <= 1);
  }
});

test("fake constellation visual metrics stay finite and inside the 3D sphere envelope", () => {
  const graph = createFakeConstellationGraph();

  for (const node of graph.nodes) {
    assert.ok(Number.isFinite(node.x));
    assert.ok(Number.isFinite(node.y));
    assert.ok(Number.isFinite(node.z));
    assert.ok(node.magnitude >= 0 && node.magnitude <= 1);
    assert.ok(node.priority >= 0 && node.priority <= 1);
    assert.ok(node.phase >= 0 && node.phase <= Math.PI * 2);
    assert.ok(Math.hypot(node.x, node.y, node.z) <= CONSTELLATION_SPHERE_RADIUS + 280);
  }
});

test("3D focus rotation brings a target onto the camera axis", () => {
  const point = { x: -310, y: 220, z: 460 };
  const rotation = focusRotationForPoint(point);
  const rotated = rotateConstellationVector(point, rotation);
  const projection = projectConstellationPoint(point, rotation, 1200, 800, 1700, 640);

  assert.ok(Math.abs(rotated.x) < 0.001);
  assert.ok(Math.abs(rotated.y) < 0.001);
  assert.ok(rotated.z > 0);
  assert.ok(Math.abs(projection.x - 600) < 0.001);
  assert.ok(Math.abs(projection.y - 400) < 0.001);
});

test("local orbit rotation preserves distance from its selected hub", () => {
  const origin = { x: 120, y: -40, z: 300 };
  const point = { x: 245, y: 20, z: 338 };
  const rotated = rotateConstellationPointAroundAxis(point, origin, origin, Math.PI / 3);
  const initialDistance = Math.hypot(
    point.x - origin.x,
    point.y - origin.y,
    point.z - origin.z,
  );
  const rotatedDistance = Math.hypot(
    rotated.x - origin.x,
    rotated.y - origin.y,
    rotated.z - origin.z,
  );

  assert.ok(Math.abs(initialDistance - rotatedDistance) < 0.001);
  assert.deepEqual(DEFAULT_CONSTELLATION_ROTATION, { yaw: -0.28, pitch: -0.1 });
});

test("horizontal wheel gestures produce bounded yaw changes without consuming vertical scroll", () => {
  assert.equal(
    getConstellationWheelYawDelta({
      deltaX: 50,
      deltaY: 4,
      deltaMode: 0,
      shiftKey: false,
    }),
    0.09,
  );
  assert.equal(
    getConstellationWheelYawDelta({
      deltaX: -50,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
    }),
    -0.09,
  );
  assert.equal(
    getConstellationWheelYawDelta({
      deltaX: 0,
      deltaY: 50,
      deltaMode: 0,
      shiftKey: false,
    }),
    0,
  );
  assert.equal(
    getConstellationWheelYawDelta({
      deltaX: 0,
      deltaY: 2,
      deltaMode: 1,
      shiftKey: true,
    }),
    0.0576,
  );
  assert.equal(
    getConstellationWheelYawDelta({
      deltaX: 100,
      deltaY: 0,
      deltaMode: 1,
      shiftKey: false,
    }),
    0.28,
  );
});

test("category focus subtly highlights only that category's descendants", () => {
  const graph = createFakeConstellationGraph();
  const category = graph.nodes.find((node) => node.id === "category:stories");
  const project = graph.nodes.find(
    (node) => node.kind === "project" && node.categoryId === "stories",
  );
  const system = graph.nodes.find(
    (node) => node.kind === "system" && node.categoryId === "stories",
  );
  const otherProject = graph.nodes.find(
    (node) => node.kind === "project" && node.categoryId === "tools",
  );
  assert.ok(category);
  assert.ok(project);
  assert.ok(system);
  assert.ok(otherProject);

  assert.equal(isConstellationCategoryDescendantHighlighted(project, category, null), true);
  assert.equal(isConstellationCategoryDescendantHighlighted(system, category, null), true);
  assert.equal(isConstellationCategoryDescendantHighlighted(category, category, null), false);
  assert.equal(isConstellationCategoryDescendantHighlighted(otherProject, category, null), false);
  assert.equal(isConstellationCategoryDescendantHighlighted(project, category, project), false);
});

test("hierarchy interaction maps cluster stars to the current navigation level", () => {
  const graph = createFakeConstellationGraph();
  const categoryId = "category:stories";
  const project = graph.nodes.find((node) => node.parentId === categoryId && node.kind === "project");
  assert.ok(project);
  const system = graph.nodes.find((node) => node.parentId === project.id && node.kind === "system");
  assert.ok(system);

  assert.equal(resolveConstellationInteractionTarget(graph, system.id, null), categoryId);
  assert.equal(resolveConstellationInteractionTarget(graph, system.id, categoryId), project.id);
  assert.equal(resolveConstellationInteractionTarget(graph, system.id, project.id), system.id);
  assert.equal(getConstellationBackTarget(graph, system.id), project.id);
  assert.equal(getConstellationBackTarget(graph, project.id), categoryId);
  assert.equal(getConstellationBackTarget(graph, categoryId), null);
});

test("labels preserve the selected hierarchy path and add only the active hover target", () => {
  const graph = createFakeConstellationGraph();
  const categoryId = "category:stories";
  const project = graph.nodes.find((node) => node.parentId === categoryId && node.kind === "project");
  assert.ok(project);
  const systems = graph.nodes.filter((node) => node.parentId === project.id && node.kind === "system");
  assert.ok(systems.length >= 2);

  assert.deepEqual(getConstellationLabelIds(graph, null, categoryId), [categoryId]);
  assert.deepEqual(getConstellationLabelIds(graph, categoryId, project.id), [categoryId, project.id]);
  assert.deepEqual(
    getConstellationLabelIds(graph, project.id, systems[0].id),
    [categoryId, project.id, systems[0].id],
  );
  assert.deepEqual(
    getConstellationLabelIds(graph, systems[0].id, systems[1].id),
    [categoryId, project.id, systems[0].id, systems[1].id],
  );
});

test("color staging keeps children white until their branch is hovered", () => {
  const graph = createFakeConstellationGraph();
  const categoryId = "category:tools";
  const project = graph.nodes.find((node) => node.parentId === categoryId && node.kind === "project");
  assert.ok(project);
  const systems = graph.nodes.filter((node) => node.parentId === project.id && node.kind === "system");
  assert.ok(systems.length > 1);

  const overviewColors = getConstellationColoredNodeIds(graph, null, null);
  assert.equal(overviewColors.size, CONSTELLATION_CATEGORIES.length);
  assert.ok(overviewColors.has(categoryId));
  assert.ok(!overviewColors.has(project.id));

  assert.deepEqual(
    [...getConstellationColoredNodeIds(graph, categoryId, null)],
    [categoryId],
  );

  const projectHoverColors = getConstellationColoredNodeIds(graph, categoryId, project.id);
  assert.ok(projectHoverColors.has(project.id));
  assert.ok(projectHoverColors.has(systems[0].id));
  assert.ok(projectHoverColors.has(categoryId));

  const systemHoverColors = getConstellationColoredNodeIds(graph, project.id, systems[0].id);
  assert.deepEqual([...systemHoverColors], [systems[0].id, project.id]);
});
