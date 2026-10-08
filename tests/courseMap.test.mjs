import test from "node:test";
import assert from "node:assert/strict";
import { featuresForHole, fetchCourseFeatures, greenPinsByHole, osmCourseQuery, projectHoleFeatures } from "../src/courseMap.js";

const mappedHole = [
  {type:"way",id:1,tags:{golf:"hole",ref:"1"},geometry:[{lat:-23.1,lon:150.7},{lat:-23.101,lon:150.701}]},
  {type:"way",id:2,tags:{golf:"green",ref:"1"},geometry:[{lat:-23.101,lon:150.701},{lat:-23.1011,lon:150.7011},{lat:-23.101,lon:150.701}]},
  {type:"way",id:3,tags:{golf:"hole",ref:"2"},geometry:[{lat:-23.1,lon:150.7},{lat:-23.102,lon:150.702}]},
];

test("course query is bounded and rejects invalid coordinates", () => {
  assert.match(osmCourseQuery(-23.1,150.7),/around:2200/);
  assert.throws(()=>osmCourseQuery("bad",150.7),/invalid/i);
});

test("course lookup falls back when an Overpass instance fails", async () => {
  const calls = [];
  const elements = [{ type: "node", id: 9, tags: { golf: "green" } }];
  const result = await fetchCourseFeatures("[out:json];", async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new Error("server unavailable");
    return { ok: true, json: async () => ({ elements }) };
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result, elements);
});

test("mapped pin is linked to its numbered hole and one-hole view excludes other holes", () => {
  const pins=greenPinsByHole(mappedHole);
  assert.ok(pins[1]);
  assert.equal(featuresForHole(mappedHole,1).some(feature=>feature.id===3),false);
  assert.equal(featuresForHole(mappedHole,1).length,2);
});

test("selected hole geometry projects into a drawable viewport", () => {
  const projected=projectHoleFeatures(featuresForHole(mappedHole,1));
  assert.equal(projected.shapes.length,2);
  assert.ok(projected.shapes.flatMap(shape=>shape.points).every(point=>point.x>=0&&point.x<=320&&point.y>=0&&point.y<=250));
});
