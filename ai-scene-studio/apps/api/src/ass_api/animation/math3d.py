"""Mathématiques 3D minimales en Python pur (quaternions XYZW, matrices 4x4 en lignes)."""

import math
from typing import Any

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]
Mat4 = list[list[float]]


def quat_multiply(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quat_normalize(q: Quat) -> Quat:
    n = math.hypot(*q)
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def quat_inverse(q: Quat) -> Quat:
    x, y, z, w = quat_normalize(q)
    return (-x, -y, -z, w)


def quat_from_axis_angle(axis: Vec3, angle: float) -> Quat:
    s = math.sin(angle / 2)
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(angle / 2))


def compose(position: Any, rotation: Any, scale: Any) -> Mat4:
    x, y, z, w = rotation
    sx, sy, sz = scale
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return [
        [(1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, position[0]],
        [(xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, position[1]],
        [(xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, position[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]


def multiply(a: Mat4, b: Mat4) -> Mat4:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def translation(m: Mat4) -> Vec3:
    return (m[0][3], m[1][3], m[2][3])


def rotation_quaternion(m: Mat4) -> Quat:
    """Rotation d'une matrice affine, échelle retirée (comme Quaternion.setFromRotationMatrix)."""
    cols = [[m[r][c] for r in range(3)] for c in range(3)]
    norms = [math.hypot(*col) for col in cols]
    r = [[cols[c][row] / norms[c] for c in range(3)] for row in range(3)]
    return _quat_from_rotation(r)


def _quat_from_rotation(r: list[list[float]]) -> Quat:
    m11, m12, m13 = r[0]
    m21, m22, m23 = r[1]
    m31, m32, m33 = r[2]
    trace = m11 + m22 + m33
    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        return ((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s)
    if m11 > m22 and m11 > m33:
        s = 2.0 * math.sqrt(1.0 + m11 - m22 - m33)
        return (0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s)
    if m22 > m33:
        s = 2.0 * math.sqrt(1.0 + m22 - m11 - m33)
        return ((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s)
    s = 2.0 * math.sqrt(1.0 + m33 - m11 - m22)
    return ((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s)


def look_at_quaternion(eye: Vec3, target: Vec3, up: Vec3) -> Quat:
    """Orientation dont -Z vise la cible (+Z va de la cible vers l'œil), comme Matrix4.lookAt."""
    z = [eye[i] - target[i] for i in range(3)]
    zn = math.hypot(*z)
    z = [v / zn for v in z]
    x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]
    xn = math.hypot(*x)
    if xn == 0:
        z[2] += 0.0001
        zn = math.hypot(*z)
        z = [v / zn for v in z]
        x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]
        xn = math.hypot(*x)
    x = [v / xn for v in x]
    y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    rotation = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]
    return _quat_from_rotation(rotation)
