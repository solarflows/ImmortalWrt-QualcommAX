/*
 **************************************************************************
 * Copyright (c) 2014-2017, The Linux Foundation. All rights reserved.
 * Copyright (c) 2024 Qualcomm Innovation Center, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and/or distribute this software for
 * any purpose with or without fee is hereby granted, provided that the
 * above copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
 * OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 **************************************************************************
 */

/*
 * nss_pm.c
 *    NSS Power Management APIs
 *
 */
#include <linux/debugfs.h>
#include <linux/module.h>
#include <linux/netdevice.h>
#include <nss_api_if.h>
#include <nss_core.h>



/*
 * nss_pm_client_register
 *    Initialize GMAC specific PM parameters
 *
 * Creates debugfs hooks for user-space control of NSS Client PM
 * Initializes Bus BW to Idle Perf level
 * Returns PM handle to the caller.
 *
 */
void *nss_pm_client_register(nss_pm_client_t client_id)
{
	return NULL;
}
EXPORT_SYMBOL(nss_pm_client_register);

/*
 * nss_pm_client_unregister
 *    Unregister the client for any PM operations
 */
int nss_pm_client_unregister(nss_pm_client_t client_id)
{
	return NSS_PM_API_FAILED;
}

/*
 * nss_pm_set_perf_level()
 *    Sets the performance level of client specific Fabrics and Clocks to requested level
 */
nss_pm_interface_status_t nss_pm_set_perf_level(void *handle, nss_pm_perf_level_t lvl)
{
#if (NSS_FREQ_SCALE_SUPPORT == 1)
#if !defined(NSS_HAL_IPQ807x_SUPPORT)
	nss_freq_scales_t index;

	switch (lvl) {
	case NSS_PM_PERF_LEVEL_TURBO:
		index = NSS_FREQ_HIGH_SCALE;
		break;

	case NSS_PM_PERF_LEVEL_NOMINAL:
		index = NSS_FREQ_MID_SCALE;
		break;

	default:
		index = NSS_FREQ_MID_SCALE;
	}

	nss_freq_sched_change(index, false);
#endif

#endif

	return NSS_PM_API_SUCCESS;
}
EXPORT_SYMBOL(nss_pm_set_perf_level);

