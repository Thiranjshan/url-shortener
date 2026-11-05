# Load Test Results

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| Date           | 2026-11-05                                                            |
| Target         | k3s on one AWS EC2 instance (c7i-flex.large, 2 vCPU / 4 GiB)          |
| Load generator | k6 from a home laptop over the internet                               |
| Scenario       | Redirects only, stepping from 25 to 300 requests/s, 1 minute per step |

## Results

| Metric                             | Value                                  |
| ---------------------------------- | -------------------------------------- |
| Highest observed rate in Grafana   | 266 requests/s (previously recorded)   |
| Average request rate over the test | 105.49 requests/s                      |
| Total HTTP requests                | 35,897                                 |
| Client-side average latency        | 406.60 ms                              |
| Client-side median latency         | 342.92 ms                              |
| Client-side latency p90            | 566.21 ms                              |
| **Client-side latency p95**        | **799.88 ms**                          |
| **Client-side latency p99**        | **1,200 ms**                           |
| Maximum client-side latency        | 2,690 ms                               |
| Server-side redirect latency p95   | 23.9 ms (previous Grafana observation) |
| HTTP request failure rate          | 0.00% (0/35,897)                       |
| Redirect checks passed             | 100% (35,875/35,875)                   |
| Dropped iterations                 | 275                                    |
| Maximum active virtual users       | 318                                    |
| Maximum configured virtual users   | 325                                    |
| Total data received                | 4.0 MB                                 |
| Total data sent                    | 1.9 MB                                 |

## Threshold Results

| Threshold                 | Requirement       | Actual      | Status |
| ------------------------- | ----------------- | ----------- | ------ |
| HTTP request duration p95 | Below 800 ms      | 799.88 ms   | PASS   |
| HTTP request failure rate | Below 1%          | 0.00%       | PASS   |
| HTTP 302 redirect checks  | Expected response | 100% passed | PASS   |

Both configured k6 thresholds passed.

The p95 latency was only 0.12 ms below the configured limit, indicating that the system was operating very close to the latency threshold.

## Execution Summary

```text
THRESHOLDS

http_req_duration
✓ 'p(95)<800' p(95)=799.88ms

http_req_failed
✓ 'rate<0.01' rate=0.00%


TOTAL RESULTS

checks_total.............: 35875
checks_succeeded.........: 100.00% (35875/35875)
checks_failed............: 0.00% (0/35875)

✓ is a 302 redirect

HTTP

http_req_duration........: avg=406.6ms
                           med=342.92ms
                           p(90)=566.21ms
                           p(95)=799.88ms
                           p(99)=1.2s
                           max=2.69s

http_req_failed..........: 0.00% (0/35897)
http_reqs................: 35897 (105.49/s)

EXECUTION

dropped_iterations.......: 275
iteration_duration.......: avg=416.81ms
                           med=343.28ms
                           p(90)=584.19ms
                           p(95)=851.13ms
                           p(99)=1.28s
                           max=5.09s

iterations...............: 35875 (105.43/s)

vus......................: max=318
vus_max..................: max=325

NETWORK

data_received............: 4.0 MB
data_sent................: 1.9 MB
```

## Observations

### 1. Request Reliability

All 35,875 redirect checks passed, and k6 recorded no HTTP request failures across 35,897 HTTP requests.

The redirect service successfully returned the expected HTTP 302 responses for all checked redirect iterations.

### 2. Response Latency

The overall client-side p95 latency was 799.88 ms, while p99 reached 1.2 seconds.

The test passed the configured p95 threshold of 800 ms, but with very little margin.

Client-side latency includes the network round trip from the laptop to AWS, whereas server-side application latency measures processing within the application.

The previously recorded Grafana server-side p95 latency was 23.9 ms.

### 3. Dropped Iterations

k6 reported 275 dropped iterations.

These represent scheduled iterations that could not be started. They do not represent HTTP request failures.

Therefore, although the HTTP failure rate was 0%, the load generator did not execute every scheduled iteration.

### 4. Throughput

The test completed 35,897 HTTP requests with an average throughput of approximately 105.49 requests per second.

The previously recorded Grafana observation showed a peak of approximately 266 requests per second.

The overall average is lower than the peak because the test gradually increased traffic and included lower-load stages.

The k6 summary alone does not establish the highest request rate sustained for a complete stage.

### 5. Asynchronous Analytics

Each successful redirect publishes a click event to RabbitMQ, which the analytics service processes and stores in TimescaleDB.

Earlier monitoring showed approximately 36,000 cumulative redirect responses and stored clicks.

However, cumulative counter values alone do not establish that every event from this specific test was stored. Confirming complete event delivery requires comparing counter increases over the test interval and allowing the consumer to process any remaining backlog.

## Notes

- The test runs from a laptop over the public internet against the AWS deployment.
- Every redirect performs a database lookup because caching has not yet been implemented.
- RabbitMQ decouples click recording from the redirect response.
- Prometheus and Grafana provide server-side metrics during the load test.
- k6 provides client-side request performance and execution metrics.
- All configured k6 thresholds passed, but the latency threshold was nearly reached.
- The test recorded 275 dropped iterations despite having zero HTTP request failures.

## Conclusion

The URL Shortener Platform completed the load test with **35,897 HTTP requests, zero HTTP request failures, and a 100% redirect-check success rate**.

The client-side p95 latency of 799.88 ms satisfied the configured 800 ms threshold, although the narrow margin and 275 dropped iterations indicate that further performance investigation would be valuable.

The results provide evidence of successful redirect handling under increasing traffic, while highlighting potential improvements such as redirect caching, database optimization, and additional load testing.
