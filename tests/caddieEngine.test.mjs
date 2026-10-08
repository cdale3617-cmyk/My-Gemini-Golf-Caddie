import test from "node:test";
import assert from "node:assert/strict";
import { calculatePlaysLike, displayToMetres, haversineMetres, metresToDisplay, recommendClub } from "../src/caddieEngine.js";

test("same GPS point returns zero distance", () => assert.equal(haversineMetres({latitude:-23,longitude:150},{latitude:-23,longitude:150}), 0));
test("GPS distance is symmetric and returns metres", () => {
  const a={latitude:-23.13,longitude:150.74}, b={latitude:-23.1309,longitude:150.74};
  assert.equal(haversineMetres(a,b),haversineMetres(b,a));
  assert.ok(haversineMetres(a,b)>90 && haversineMetres(a,b)<110);
});
test("calm, flat stock shot keeps measured distance", () => assert.equal(calculatePlaysLike({distanceM:150}),150));
test("headwind adds distance and tailwind reduces it", () => {
  assert.ok(calculatePlaysLike({distanceM:150,windKmh:20,windDirection:"head"})>150);
  assert.ok(calculatePlaysLike({distanceM:150,windKmh:20,windDirection:"tail"})<150);
});
test("tournament mode suppresses manual elevation; smooth shot changes target", () => {
  assert.equal(calculatePlaysLike({distanceM:100,elevationM:10,tournamentMode:true}),100);
  assert.equal(calculatePlaysLike({distanceM:100,shotType:"smooth"}),110);
});
test("unit conversion and nearest club selection work", () => {
  assert.equal(metresToDisplay(100,"yd"),109);
  assert.equal(displayToMetres(100,"yd"),91);
  assert.equal(recommendClub(147,[{name:"7 Iron",carryM:140},{name:"6 Iron",carryM:150}]).name,"6 Iron");
});
