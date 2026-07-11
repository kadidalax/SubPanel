from pathlib import Path
import re
bq = chr(96)

p = Path('src/services/health.ts')
t = p.read_text(encoding='utf-8')
if 'loadSubscriptionNodes' not in t:
    t = t.replace(
        'import { nowMs } from "../util/time.ts";',
        'import { nowMs } from "../util/time.ts";\nimport { getSubscriptionGroupIds, loadSubscriptionNodes } from "./subscription_groups.ts";',
    )
