# Load test results

|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| Date           | 2026-11-05                                                       |
| Target         | k3s on one AWS EC2 instance (c7i-flex.large, 2 vCPU / 4 GiB)     |
| Load generator | k6 from a home laptop over the internet                          |
| Scenario       | Redirects only, stepping 25 to 300 requests/s, 1 minute per step |

## Results

| Metric                                        | Value                                      |
| --------------------------------------------- | ------------------------------------------ |
| Highest rate sustained with errors under 1%   | 266 requests/s                             |
| Client-side latency p95 / p99 at that rate    | N ms / N ms (includes internet round trip) |
| Server-side redirect latency p95 at that rate | 23.9 ms (from Grafana)                     |
| Error rate over the whole test                | 0%                                         |
| Dropped iterations                            | 0                                          |
| Clicks stored vs redirects served             | 266 vs 266                                 |

## Notes

- Client-side latency includes the round trip from the laptop to AWS; server-side latency does not.
- Every redirect performs a database lookup (there is no cache yet).
