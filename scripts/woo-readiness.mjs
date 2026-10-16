import { wooReadiness } from "../src/lib/woocommerce/readiness.mts";

const report = wooReadiness(process.env);
console.log(JSON.stringify(report, null, 2));
// Zero means offline configuration checks pass, NOT that deployment is approved.
process.exitCode = report.configurationChecksPassed ? 0 : 1;