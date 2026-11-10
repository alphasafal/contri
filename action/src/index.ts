import { report, run } from './run';

run(process.env)
  .then((result) => report(result, process.env))
  .catch((error: unknown) => {
    // A failed check must never block a pull request: say why and exit cleanly unless asked otherwise.
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `::${process.env['INPUT_FAIL-ON-ERROR'] === 'true' ? 'error' : 'warning'}::CONTRI could not finish: ${message}`,
    );
    process.exitCode = process.env['INPUT_FAIL-ON-ERROR'] === 'true' ? 1 : 0;
  });
