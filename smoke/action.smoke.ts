import { expect, smoke } from 'smoque';

smoke.suite('committed GitHub Action bundle', { tags: ['artifact'] }, async (t) => {
    const root = t.repoRoot();
    const work = await t.tempDir('action-bundle');
    const githubOutput = work.path('github-output');
    const githubPath = work.path('github-path');

    await t.step('prepare isolated GitHub command files', async () => {
        await t.fs.writeText(githubOutput, '');
        await t.fs.writeText(githubPath, '');
    });

    await t.step('bundled action boots and fails invalid input before networking', async () => {
        const result = await t.cmd(process.execPath, ['dist/index.js'], {
            check: false,
            cwd: root,
            env: {
                GITHUB_OUTPUT: githubOutput,
                GITHUB_PATH: githubPath,
                INPUT_CHANNEL: 'zap',
                INPUT_SHA256: 'invalid',
                INPUT_VERSION: '0.1.0-zap.20260804.6ccff768b7bc',
            },
        });

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain(
            '::error::Input `sha256` must be exactly 64 hexadecimal characters.',
        );
        expect(await t.fs.readText(githubOutput)).toBe('');
        expect(await t.fs.readText(githubPath)).toBe('');
    });
});
