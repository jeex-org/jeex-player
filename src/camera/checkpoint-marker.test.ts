/**
 * The camera glyph's structure: an x-ray twin that draws only where something
 * nearer hides the body, the frustum and outline only on the active camera,
 * floor parts that turn with the yaw but never tilt with the pitch, a size
 * floor that scales the body and not the footprint, and a frustum at the
 * field of view it was given.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ACCENT, CameraMarker, GLYPH_TOP_M, cameraBodyGeometry, frustumCorners, horizontalFov } from './checkpoint-marker.js';

const CAM = { id: '01a12ffa-7374-7ac6-bee6-402a9a6bb61f', position: { x: 2, y: 1.6, z: 3 }, yaw: 0.7, pitch: -0.4 };
const FOV = { horizontal: 1.2, vertical: 0.8 };
const IDLE = { active: false, hovered: false, invalid: false };

function meshes(marker: CameraMarker): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  marker.root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

describe('CameraMarker', () => {
  test("the x-ray twin is the convex body box only, so it never ghosts the glyph's own barrel through the body", () => {
    const marker = new CameraMarker(CAM.id);
    const xray = meshes(marker).find((mesh) => mesh.name === 'xray')!;
    xray.geometry.computeBoundingBox();
    expect(xray.geometry.boundingBox!.max.z).toBeLessThan(0.05 + 1e-6);
    expect(xray.geometry.boundingBox!.max.y).toBeLessThan(0.061);
  });

  test('the x-ray twin draws only behind something nearer, never over its own visible body', () => {
    const marker = new CameraMarker(CAM.id);
    const xray = meshes(marker).find((mesh) => mesh.name === 'xray')!;
    const material = xray.material as THREE.MeshBasicMaterial;
    expect(material.depthFunc).toBe(THREE.GreaterDepth);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBeGreaterThanOrEqual(0.25);
    expect(material.opacity).toBeLessThanOrEqual(0.35);
  });

  test('the frustum and the outline show on the active camera only, and the lens carries the accent', () => {
    const marker = new CameraMarker(CAM.id);
    marker.sync(CAM, FOV, IDLE);
    expect(marker.emphasised).toBe(false);
    marker.sync(CAM, FOV, { ...IDLE, active: true });
    expect(marker.emphasised).toBe(true);
    expect(marker.lensColour).toBe(ACCENT);
  });

  test('active carries the accent outline and the frustum; an inactive camera keeps a thin dark edge so it reads at the size floor', () => {
    const marker = new CameraMarker(CAM.id);
    marker.sync(CAM, FOV, IDLE);
    const outline = meshes(marker).find((mesh) => (mesh.material as THREE.Material).side === THREE.BackSide)!;
    expect(outline.visible).toBe(true);
    expect((outline.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(ACCENT);
    marker.sync(CAM, FOV, { ...IDLE, active: true });
    expect((outline.material as THREE.MeshBasicMaterial).color.getHex()).toBe(ACCENT);
    expect(outline.scale.x).toBeGreaterThan(1.1);
    marker.sync(CAM, FOV, IDLE);
    expect(marker.emphasised).toBe(false);
  });

  test('the body is lit graphite, never near-black, and the glass in front is lighter than it', () => {
    const marker = new CameraMarker(CAM.id);
    marker.sync(CAM, FOV, IDLE);
    const lit = meshes(marker).filter((mesh) => mesh.material instanceof THREE.MeshLambertMaterial);
    const luminance = (mesh: THREE.Mesh): number => {
      const colour = (mesh.material as THREE.MeshLambertMaterial).color;
      return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
    };
    // The body is the lit mesh its x-ray twin shares a geometry with; the glass is the frontmost lit mesh.
    const xray = meshes(marker).find((mesh) => mesh.name === 'xray')!;
    const body = lit.find((mesh) => mesh.geometry === xray.geometry)!;
    const front = (mesh: THREE.Mesh): number => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.max.z;
    };
    const glass = lit.reduce((best, mesh) => (front(mesh) > front(best) ? mesh : best));
    expect(luminance(body)).toBeGreaterThan(0.05);
    expect(luminance(glass)).toBeGreaterThan(luminance(body));
  });

  test('the head turns and tilts; the floor footprint turns with the yaw only', () => {
    const marker = new CameraMarker(CAM.id);
    marker.sync(CAM, FOV, IDLE);
    marker.root.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(marker.head.getWorldQuaternion(new THREE.Quaternion()));
    expect(forward.x).toBeCloseTo(Math.sin(CAM.yaw) * Math.cos(CAM.pitch), 9);
    expect(forward.y).toBeCloseTo(Math.sin(CAM.pitch), 9);
    const footprint = marker.root.children.find((child) => child !== marker.head && child instanceof THREE.Group)!;
    expect(footprint.rotation.x).toBe(0);
    expect(footprint.rotation.y).toBeCloseTo(CAM.yaw, 12);
    expect(marker.root.position.toArray()).toEqual([2, 0, 3]);
    expect(marker.head.position.y).toBe(1.6);
  });

  test('the size floor scales the camera, not the footprint', () => {
    const marker = new CameraMarker(CAM.id);
    marker.sync(CAM, FOV, IDLE);
    marker.setScale(3);
    expect(marker.head.children[0]!.scale.x).toBe(3);
    const footprint = marker.root.children.find((child) => child !== marker.head && child instanceof THREE.Group)!;
    expect(footprint.scale.x).toBe(1);
  });

  test('the ghost is not a document camera and draws on top', () => {
    const ghost = new CameraMarker('ghost', true);
    expect(ghost.root.userData['checkpointId']).toBeUndefined();
    const drawn = meshes(ghost).filter((mesh) => mesh.visible);
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.every((mesh) => !(mesh.material as THREE.Material).depthTest)).toBe(true);
    ghost.dispose();
  });
});

describe('the frustum geometry', () => {
  test('opens at exactly the field of view it was given', () => {
    const corners = frustumCorners(FOV.horizontal, FOV.vertical, 1);
    const [bottomLeft, , topRight] = corners;
    const apexZ = topRight!.z - 1;
    expect(Math.atan2(topRight!.x, topRight!.z - apexZ) * 2).toBeCloseTo(FOV.horizontal, 9);
    expect(Math.atan2(topRight!.y, topRight!.z - apexZ) * 2).toBeCloseTo(FOV.vertical, 9);
    expect(bottomLeft!.x).toBeCloseTo(-topRight!.x, 12);
  });

  test('horizontalFov widens a vertical field of view by the aspect', () => {
    expect(horizontalFov(Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(horizontalFov(0.9, 16 / 9)).toBeGreaterThan(0.9);
  });
});

describe('the DSLR-style silhouette', () => {
  const geometry = cameraBodyGeometry();
  geometry.computeBoundingBox();
  const positions = geometry.getAttribute('position');
  const points = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index));

  test('a prism hump rises above the body, centred, and the arrow starts above it', () => {
    const top = Math.max(...points.map((point) => point.y));
    expect(top).toBeCloseTo(GLYPH_TOP_M, 2);
    const summit = points.filter((point) => point.y > top - 0.005);
    expect(Math.max(...summit.map((point) => Math.abs(point.x)))).toBeLessThan(0.04);
  });

  test("a grip on the photographer's right (−X), the barrel forward along +Z, the body footprint close to 0.20 × 0.13 × 0.10 m", () => {
    const box = geometry.boundingBox!;
    expect(-box.min.x).toBeGreaterThan(box.max.x);
    expect(box.max.z).toBeGreaterThan(0.12);
    expect(box.max.x - box.min.x).toBeLessThan(0.23);
    expect(box.max.y - box.min.y).toBeLessThan(0.2);
  });

  test("one merged geometry, within three times a plain rounded box's triangles", () => {
    const old = new RoundedBoxGeometry(0.2, 0.13, 0.1, 2, 0.02);
    const oldTriangles = (old.index?.count ?? old.getAttribute('position').count) / 3;
    expect(positions.count / 3).toBeLessThan(oldTriangles * 3);
    old.dispose();
  });
});
