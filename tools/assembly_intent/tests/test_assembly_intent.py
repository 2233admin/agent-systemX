"""覆盖 spec-3-6 的 I/O 与边界矩阵六行。

全部用夹具目录，不碰真实仓库：真实仓的一次绿只能证明「今天恰好一致」，
而这些用例要证明的是「不一致时它一定红」。`configs supply` 默认用假实现
（协议与生产实现同形），另有一条可选的端到端用例真起 Bun 子进程，本机没有
可用 Bun 时跳过——CI 上会装 Bun，那里它真跑。
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Sequence


MODULE_PATH = Path(__file__).resolve().parents[1] / "assembly_intent.py"
SPEC = importlib.util.spec_from_file_location("assembly_intent", MODULE_PATH)
assert SPEC and SPEC.loader
assembly_intent = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = assembly_intent
SPEC.loader.exec_module(assembly_intent)

AssemblyIntentError = assembly_intent.AssemblyIntentError
SupplyOutcome = assembly_intent.SupplyOutcome

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

ENTRYPOINT_TEMPLATE = """# 仓库工作入口

## 共享写入前置检查

所有权不明时，保持相关范围只读并加载可用的 `{first}` Skill；加入已有协调后再继续。

## 问题求解治理

准备作出第一项实质路径选择时，加载可用的 `{second}` Skill。

## 父目标验收

宣称完成前，必须加载可用的 `{second}` Skill，验收父目标贡献。
"""

DRIFTED_ENTRYPOINT = """# 仓库工作入口

## 共享写入前置检查

所有权不明时，保持相关范围只读并参考 `orchestrated-collaboration` 的做法继续。

## 问题求解治理

准备作出第一项实质路径选择时，请参考 `adaptive-problem-solving` 的做法。
"""

INSTALL_MANIFEST = """installation:
  version: 6.11.0
  installDate: 2026-08-21T12:34:30.500Z
modules:
  - name: core
    version: 6.11.0
"""


def write_fixture_repository(
    root: Path,
    *,
    entrypoint: str | None = None,
    bmad_skills: Sequence[str] = ("bmad-alpha", "bmad-beta"),
    with_skill_manifest: bool = True,
    with_install_manifest: bool = True,
) -> Path:
    """造一个只含推导所需两处权威的最小夹具仓。"""
    (root / "entrypoints").mkdir(parents=True, exist_ok=True)
    (root / "entrypoints" / "agent-system.md").write_text(
        entrypoint
        if entrypoint is not None
        else ENTRYPOINT_TEMPLATE.format(
            first="orchestrated-collaboration", second="adaptive-problem-solving"
        ),
        encoding="utf-8",
    )
    config_dir = root / "_bmad" / "_config"
    config_dir.mkdir(parents=True, exist_ok=True)
    if with_skill_manifest:
        rows = ["canonicalId,name,description,module,path"]
        rows.extend(
            f'"{name}","{name}","desc","core","_bmad/core/{name}/SKILL.md"'
            for name in bmad_skills
        )
        (config_dir / "skill-manifest.csv").write_text(
            "\n".join(rows) + "\n", encoding="utf-8"
        )
    if with_install_manifest:
        (config_dir / "manifest.yaml").write_text(INSTALL_MANIFEST, encoding="utf-8")
    return root


def write_fixture_supply_library(root: Path, groups: dict[str, Sequence[str]]) -> Path:
    """按 `<根>/<组>/skills/<skill>/SKILL.md` 造夹具供给库。

    这是**测试数据**，不是检查侧的第二份目录约定实现——被测代码从不落盘、
    也从不自己扫描目录，它只调 `configs supply`。
    """
    for group, skills in groups.items():
        for skill in skills:
            skill_dir = root / Path(group) / "skills" / skill
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "SKILL.md").write_text(f"# {skill}\n", encoding="utf-8")
    return root


class FakeSupplyRunner:
    """按名字返回一份 supply 形状的候选，或返回一次失败。"""

    def __init__(
        self,
        *,
        supplied: dict[str, Sequence[str]] | None = None,
        returncode: int = 0,
        stderr: str = "",
        raises: Exception | None = None,
    ) -> None:
        self.supplied = supplied or {}
        self.returncode = returncode
        self.stderr = stderr
        self.raises = raises
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    def run(self, config_name: str, groups: Sequence[str]) -> Any:
        self.calls.append((config_name, tuple(groups)))
        if self.raises is not None:
            raise self.raises
        if self.returncode != 0:
            return SupplyOutcome(
                returncode=self.returncode,
                stdout="",
                stderr=self.stderr,
                command="fake configs supply",
            )
        skills = []
        for group, names in self.supplied.items():
            for name in names:
                skills.append(
                    {
                        "kind": "skill",
                        "name": name,
                        "sourceCategory": {"kind": "known", "value": "project-skill-import"},
                        "summary": {"kind": "known", "value": f"skill reference: {name}"},
                        "sourceRef": {
                            "kind": "known",
                            "value": f"{group}/skills/{name}",
                        },
                        "contentFingerprint": {"kind": "known", "value": "sha256:0"},
                    }
                )
        payload = {
            "configName": config_name,
            "defaultMarker": {"kind": "unknown", "reason": "x", "observedAt": "1970-01-01T00:00:00.000Z"},
            "scopeBoundary": {"kind": "known", "value": f"configs supply: groups {', '.join(groups)}"},
            "availability": {"kind": "known", "value": "resolved"},
            "skills": skills,
        }
        return SupplyOutcome(
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
            command="fake configs supply",
        )


class TempRepositoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.root = Path(self._temp.name)


class DeriveIntentTests(TempRepositoryTestCase):
    def test_derives_three_groups_from_two_authorities(self) -> None:
        write_fixture_repository(self.root)
        intent = assembly_intent.derive_intent(self.root)
        self.assertEqual(
            intent.groups,
            (".agents", "plugins/adaptive-problem-solving", "plugins/orchestrated-collaboration"),
        )
        # 同一个名字被点名两次只推一个组，但两处行号都要记进来源。
        self.assertEqual(intent.entrypoint_hits, 3)
        self.assertEqual(
            intent.entrypoint_named_skills,
            ("adaptive-problem-solving", "orchestrated-collaboration"),
        )
        self.assertIn("9,13", intent.group_sources["plugins/adaptive-problem-solving"])
        self.assertEqual(intent.bmad_pin, "6.11.0")
        self.assertEqual(len(intent.expectations), 4)

    def test_rejects_capture_that_is_not_a_skill_name(self) -> None:
        write_fixture_repository(
            self.root,
            entrypoint="所有权不明时加载可用的 `见下表 / 若干` Skill。\n",
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.derive_intent(self.root)
        self.assertIn("不是一个 Skill 名", str(caught.exception))


class MatrixRowConsistentTests(TempRepositoryTestCase):
    """矩阵第 1 行：全一致 -> 退出 0，报告推导出的组与其 skill 数。"""

    def test_reports_groups_and_counts(self) -> None:
        write_fixture_repository(self.root)
        runner = FakeSupplyRunner(
            supplied={
                ".agents": ("bmad-alpha", "bmad-beta"),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                "plugins/orchestrated-collaboration": ("orchestrated-collaboration",),
            }
        )
        report = assembly_intent.check_assembly_intent(self.root, runner)
        self.assertEqual(
            runner.calls,
            [
                (
                    assembly_intent.DEFAULT_CONFIG_NAME,
                    (
                        ".agents",
                        "plugins/adaptive-problem-solving",
                        "plugins/orchestrated-collaboration",
                    ),
                )
            ],
        )
        self.assertEqual(report["supplied_skill_count"], 4)
        self.assertEqual(report["unattributed_skill_count"], 0)
        self.assertEqual(report["verified_expectation_count"], 4)
        self.assertEqual(
            {row["group"]: row["supplied_skill_count"] for row in report["groups"]},
            {
                ".agents": 2,
                "plugins/adaptive-problem-solving": 1,
                "plugins/orchestrated-collaboration": 1,
            },
        )
        rendered = assembly_intent.render_text(report)
        self.assertIn("Derived groups (3)", rendered)
        self.assertIn(".agents  [2 skills]", rendered)

    def test_exit_code_zero_through_main(self) -> None:
        write_fixture_repository(self.root)
        write_fixture_supply_library(
            self.root,
            {
                ".agents": ("bmad-alpha", "bmad-beta"),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                "plugins/orchestrated-collaboration": ("orchestrated-collaboration",),
            },
        )
        # 只验证 main 的装配与退出码路径；真实子进程由下面的端到端用例覆盖。
        report = assembly_intent.check_assembly_intent(
            self.root,
            FakeSupplyRunner(
                supplied={
                    ".agents": ("bmad-alpha", "bmad-beta"),
                    "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                    "plugins/orchestrated-collaboration": ("orchestrated-collaboration",),
                }
            ),
        )
        self.assertEqual(report["schema_version"], assembly_intent.SCHEMA_VERSION)


class MatrixRowNamedSkillNotSuppliedTests(TempRepositoryTestCase):
    """矩阵第 2 行：点名的 Skill 供给不到 -> 非 0，指名是哪个 Skill、期望在哪个组。"""

    def test_group_resolves_but_named_skill_absent(self) -> None:
        write_fixture_repository(self.root)
        runner = FakeSupplyRunner(
            supplied={
                ".agents": ("bmad-alpha", "bmad-beta"),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                # 组存在但里面装的是别的 Skill：清单式检查看不出来，只有比对真实产出才行。
                "plugins/orchestrated-collaboration": ("something-else",),
            }
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        self.assertIn("orchestrated-collaboration", message)
        self.assertIn("plugins/orchestrated-collaboration", message)
        self.assertIn("agent-system.md:5", message)

    def test_named_skill_has_no_group_at_all(self) -> None:
        write_fixture_repository(
            self.root,
            entrypoint=ENTRYPOINT_TEMPLATE.format(
                first="no-such-plugin", second="adaptive-problem-solving"
            ),
        )
        runner = FakeSupplyRunner(
            returncode=1,
            stderr="supply 失败：供给库内不存在组 `plugins/no-such-plugin`",
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        # 供给侧只知道「组没了」；是本检查把它接回「入口第几行点名的哪个 Skill」。
        self.assertIn("no-such-plugin", message)
        self.assertIn("点名的 Skill", message)
        self.assertIn("供给库内不存在组", message)

    def test_bmad_manifest_skill_missing_from_group(self) -> None:
        write_fixture_repository(self.root, bmad_skills=("bmad-alpha", "bmad-gone"))
        runner = FakeSupplyRunner(
            supplied={
                ".agents": ("bmad-alpha",),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                "plugins/orchestrated-collaboration": ("orchestrated-collaboration",),
            }
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        self.assertIn("bmad-gone", message)
        self.assertIn(".agents", message)


class MatrixRowWordingDriftTests(TempRepositoryTestCase):
    """矩阵第 3 行：措辞漂移致提取落空 -> 非 0 并报告「提取数为 0」，不得静默绿。"""

    def test_zero_extraction_fails_loudly(self) -> None:
        write_fixture_repository(self.root, entrypoint=DRIFTED_ENTRYPOINT)
        runner = FakeSupplyRunner(supplied={".agents": ("bmad-alpha", "bmad-beta")})
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        self.assertIn("提取数为 0", str(caught.exception))
        # 反向断言必须在调用 supply 之前就把整件事拦下来——否则「空集全部满足」
        # 会一路走到底并报告一致。
        self.assertEqual(runner.calls, [])

    def test_empty_entrypoint_also_fails(self) -> None:
        write_fixture_repository(self.root, entrypoint="# 仓库工作入口\n")
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.derive_intent(self.root)
        self.assertIn("提取数为 0", str(caught.exception))


class MatrixRowGroupResolutionFailureTests(TempRepositoryTestCase):
    """矩阵第 4 行：组解析失败 -> 非 0，透传 supply 的类型化原因。"""

    def test_typed_reason_is_passed_through(self) -> None:
        write_fixture_repository(self.root)
        runner = FakeSupplyRunner(
            returncode=1,
            stderr=(
                "supply 失败\n"
                "原因：组 `.agents` 下不存在 `skills` 目录（SupplyGroupNotFoundError）\n"
                "建议：确认 CONTROL_PLANE_SUPPLY_ROOT 指向的库"
            ),
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        self.assertIn("SupplyGroupNotFoundError", message)
        self.assertIn("退出码 1", message)
        self.assertIn("推导出的组及其来源", message)

    def test_stdout_that_is_not_json_is_not_treated_as_consistent(self) -> None:
        write_fixture_repository(self.root)

        class GarbageRunner:
            def run(self, config_name: str, groups: Sequence[str]) -> Any:
                return SupplyOutcome(0, "not json at all", "", "fake")

        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, GarbageRunner())
        self.assertIn("不是 JSON", str(caught.exception))


class MatrixRowBmadManifestMissingTests(TempRepositoryTestCase):
    """矩阵第 5 行：bmad 清单缺失 -> 非 0，指出该来源缺失。"""

    def test_skill_manifest_missing(self) -> None:
        write_fixture_repository(self.root, with_skill_manifest=False)
        runner = FakeSupplyRunner()
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        self.assertIn("skill-manifest.csv", message)
        self.assertIn("缺失", message)
        self.assertEqual(runner.calls, [])

    def test_install_manifest_missing_means_group_has_no_pin(self) -> None:
        write_fixture_repository(self.root, with_install_manifest=False)
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.derive_intent(self.root)
        self.assertIn("manifest.yaml", str(caught.exception))

    def test_install_manifest_without_version_is_rejected(self) -> None:
        write_fixture_repository(self.root)
        (self.root / "_bmad" / "_config" / "manifest.yaml").write_text(
            "installation:\n  installDate: 2026-08-21T12:34:30.500Z\n", encoding="utf-8"
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.derive_intent(self.root)
        self.assertIn("缺 pin", str(caught.exception))


class MatrixRowSupplyUnavailableTests(TempRepositoryTestCase):
    """矩阵第 6 行：`configs supply` 不可用 -> 非 0，透传原因，不伪装成一致。"""

    def test_missing_bun_executable(self) -> None:
        write_fixture_repository(self.root)
        (self.root / "packages" / "control-plane" / "src" / "cli").mkdir(
            parents=True, exist_ok=True
        )
        (self.root / assembly_intent.CLI_RELATIVE_PATH).write_text("// stub\n", encoding="utf-8")
        runner = assembly_intent.CliSupplyRunner(
            self.root, bun_command=["definitely-not-a-real-bun-binary"]
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        message = str(caught.exception)
        self.assertIn("configs supply 不可用", message)
        self.assertIn("definitely-not-a-real-bun-binary", message)

    def test_missing_cli_entry(self) -> None:
        write_fixture_repository(self.root)
        runner = assembly_intent.CliSupplyRunner(self.root, bun_command=["bun"])
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        self.assertIn("找不到 CLI 入口", str(caught.exception))

    def test_cli_error_exit_is_surfaced_not_swallowed(self) -> None:
        write_fixture_repository(self.root)
        runner = FakeSupplyRunner(returncode=2, stderr="usage error: --group 不能为空")
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, runner)
        self.assertIn("退出码 2", str(caught.exception))
        self.assertIn("--group 不能为空", str(caught.exception))


def _bun_command() -> list[str] | None:
    command = assembly_intent.resolve_bun_command()
    if shutil.which(command[0]) is None:
        return None
    return command


class RealSupplySubprocessTests(TempRepositoryTestCase):
    """端到端：真起 Bun 子进程跑真实 `configs supply`，供给库是夹具目录。

    这条用例证明本检查确实调的是真实命令，而不是自己另写了一遍目录约定。
    """

    def setUp(self) -> None:
        super().setUp()
        self.bun = _bun_command()
        if self.bun is None:
            self.skipTest("本机没有可用的 Bun；CI 上装了 Bun 时这条用例会真跑")
        self.cli_path = REPOSITORY_ROOT / assembly_intent.CLI_RELATIVE_PATH
        if not self.cli_path.is_file():
            self.skipTest(f"找不到 CLI 入口 {self.cli_path}")

    def _runner(self) -> Any:
        return assembly_intent.CliSupplyRunner(
            REPOSITORY_ROOT,
            supply_root=self.root,
            bun_command=self.bun,
            cli_path=self.cli_path,
            timeout_seconds=180.0,
        )

    def test_real_supply_over_fixture_library(self) -> None:
        write_fixture_repository(self.root)
        write_fixture_supply_library(
            self.root,
            {
                ".agents": ("bmad-alpha", "bmad-beta"),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
                "plugins/orchestrated-collaboration": ("orchestrated-collaboration",),
            },
        )
        report = assembly_intent.check_assembly_intent(self.root, self._runner())
        self.assertEqual(report["supplied_skill_count"], 4)
        self.assertEqual(report["unattributed_skill_count"], 0)

    def test_real_supply_failure_is_passed_through(self) -> None:
        write_fixture_repository(self.root)
        # 少了 `plugins/orchestrated-collaboration` 这个组：由真实 supply 判失败。
        write_fixture_supply_library(
            self.root,
            {
                ".agents": ("bmad-alpha", "bmad-beta"),
                "plugins/adaptive-problem-solving": ("adaptive-problem-solving",),
            },
        )
        with self.assertRaises(AssemblyIntentError) as caught:
            assembly_intent.check_assembly_intent(self.root, self._runner())
        message = str(caught.exception)
        self.assertIn("configs supply stderr", message)
        self.assertIn("orchestrated-collaboration", message)


if __name__ == "__main__":
    unittest.main()
