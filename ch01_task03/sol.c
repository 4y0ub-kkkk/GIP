#include <stdlib.h>

char *findDifferentBinaryString(char **nums, int numsSize, int n)
{
    char *result = malloc((size_t)n + 1);

    (void)numsSize;

    if (result == NULL) {
        return NULL;
    }

    for (int i = 0; i < n; i++) {
        result[i] = nums[i][i] == '0' ? '1' : '0';
    }
    result[n] = '\0';

    return result;
}