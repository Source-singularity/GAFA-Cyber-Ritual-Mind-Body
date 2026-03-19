#ifndef SPO2_ALGORITHM_H
#define SPO2_ALGORITHM_H

#include <stdint.h>

void maxim_heart_rate_and_oxygen_saturation(
    uint32_t *irBuffer,
    int32_t bufferLength,
    uint32_t *redBuffer,
    int32_t *spo2,
    int8_t *validSPO2,
    int32_t *heartRate,
    int8_t *validHeartRate
);

#endif
