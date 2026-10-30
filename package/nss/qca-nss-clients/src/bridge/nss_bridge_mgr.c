/*
 **************************************************************************
 * Copyright (c) 2016-2021, The Linux Foundation. All rights reserved.
 * Copyright (c) 2022 Qualcomm Innovation Center, Inc. All rights reserved.
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
 * nss_bridge_mgr.c
 *	NSS to HLOS Bridge Interface manager
 */
#include <linux/sysctl.h>
#include <linux/etherdevice.h>
#include <linux/if_vlan.h>
#include <linux/of.h>
#include <linux/if_bridge.h>
#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
#include <linux/soc/qcom/qca_ppe.h>
#endif
#include <nss_api_if.h>

#if defined(NSS_BRIDGE_MGR_OVS_ENABLE)
#include <ovsmgr.h>
#endif

#include "nss_bridge_mgr_priv.h"

/*
 * Module parameter to enable/disable OVS bridge.
 */
static bool ovs_enabled = false;

static struct nss_bridge_mgr_context br_mgr_ctx;

/*
 * nss_bridge_mgr_create_instance()
 *	Create a bridge instance.
 */
static struct nss_bridge_pvt *nss_bridge_mgr_create_instance(struct net_device *dev)
{
	struct nss_bridge_pvt *br;

#if !defined(NSS_BRIDGE_MGR_OVS_ENABLE)
	if (!netif_is_bridge_master(dev))
		return NULL;
#else
	/*
	 * When OVS is enabled, we have to check for both bridge master
	 * and OVS master.
	 */
	if (!netif_is_bridge_master(dev) && !ovsmgr_is_ovs_master(dev))
		return NULL;
#endif

	br = kzalloc(sizeof(*br), GFP_KERNEL);
	if (!br)
		return NULL;

	INIT_LIST_HEAD(&br->list);

	return br;
}

/*
 * nss_bridge_mgr_delete_instance()
 *	Delete a bridge instance from bridge list and free the bridge instance.
 */
static void nss_bridge_mgr_delete_instance(struct nss_bridge_pvt *br)
{
	spin_lock_bh(&br_mgr_ctx.lock);
	if (!list_empty(&br->list))
		list_del(&br->list);

	spin_unlock_bh(&br_mgr_ctx.lock);

	kfree(br);
}

/*
 * nss_bridge_mgr_find_instance()
 *	Find a bridge instance from bridge list.
 */
struct nss_bridge_pvt *nss_bridge_mgr_find_instance(struct net_device *dev)
{
	struct nss_bridge_pvt *br;

#if !defined(NSS_BRIDGE_MGR_OVS_ENABLE)
	if (!netif_is_bridge_master(dev))
		return NULL;
#else
	/*
	 * When OVS is enabled, we have to check for both bridge master
	 * and OVS master.
	 */
	if (!netif_is_bridge_master(dev) && !ovsmgr_is_ovs_master(dev))
		return NULL;
#endif
	/*
	 * Do we have it on record?
	 */
	spin_lock_bh(&br_mgr_ctx.lock);
	list_for_each_entry(br, &br_mgr_ctx.list, list) {
		if (br->dev == dev) {
			spin_unlock_bh(&br_mgr_ctx.lock);
			return br;
		}
	}

	spin_unlock_bh(&br_mgr_ctx.lock);
	return NULL;
}

/*
 * nss_bridge_mgr_join_bridge()
 *	Netdevice join bridge and send netdevice joining bridge message to NSS FW.
 */
int nss_bridge_mgr_join_bridge(struct net_device *dev, struct nss_bridge_pvt *br)
{
	int32_t ifnum;

	ifnum = nss_cmn_get_interface_number_by_dev(dev);
	if (ifnum < 0) {
		nss_bridge_mgr_warn("%s: failed to find interface number\n", dev->name);
		return -EINVAL;
	}

#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	/*
	 * qca_ppe moved this port into the bridge's shared VSI when it joined the
	 * Linux bridge (DSA port_bridge_join). Reuse that VSI for the firmware
	 * bridge interface: assign it on the first member, then re-assert the
	 * member/flood masks the firmware zeroes on assign.
	 */
	if (NSS_BRIDGE_MGR_IF_IS_TYPE_PHYSICAL(ifnum)) {
		int vsi = qca_ppe_bridge_vsi_get(br->dev);

		/*
		 * (Re)assign when the shared VSI qca_ppe holds for this bridge
		 * differs from what the firmware bridge interface has: covers the
		 * first member and a VSI that was freed then reallocated after all
		 * wired members had previously left.
		 */
		if (vsi >= 0 && (uint32_t)vsi != br->vsi) {
			br->vsi = vsi;
			if (nss_bridge_tx_vsi_assign_msg(br->ifnum, vsi) != NSS_TX_SUCCESS)
				nss_bridge_mgr_warn("%px: failed to assign bridge vsi %d\n", br, vsi);
			qca_ppe_bridge_vsi_refresh(br->dev);
		}
	}
#endif

	if (nss_bridge_tx_join_msg(br->ifnum, dev) != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: Interface %s join bridge failed\n", br, dev->name);
		return -EIO;
	}

#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	/* Re-assert the bridge VSI masks the firmware may have cleared. */
	qca_ppe_bridge_vsi_refresh(br->dev);
#endif
	return 0;
}

/*
 * nss_bridge_mgr_leave_bridge()
 *	Netdevice leave bridge and send netdevice leaving bridge message to NSS FW.
 */
int nss_bridge_mgr_leave_bridge(struct net_device *dev, struct nss_bridge_pvt *br)
{
	int32_t ifnum;

	ifnum = nss_cmn_get_interface_number_by_dev(dev);
	if (ifnum < 0) {
		nss_bridge_mgr_warn("%s: failed to find interface number\n", dev->name);
		return -1;
	}

	if (nss_bridge_tx_leave_msg(br->ifnum, dev) != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: Interface %s leave bridge failed\n", br, dev->name);
		return -1;
	}

#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	/*
	 * qca_ppe (DSA port_bridge_leave) restores the port's standalone VSI and
	 * STP state. If it also freed the shared bridge VSI (the last wired member
	 * left a still-existing bridge), release the firmware assignment too so the
	 * VSI number is reusable and the next join re-assigns; otherwise re-assert
	 * the remaining members.
	 */
	if (br->vsi && qca_ppe_bridge_vsi_get(br->dev) < 0) {
		nss_bridge_tx_vsi_unassign_msg(br->ifnum, br->vsi);
		br->vsi = 0;
	} else {
		qca_ppe_bridge_vsi_refresh(br->dev);
	}
#endif
	return 0;
}

/*
 * nss_bridge_mgr_unregister_br()
 *	Unregister bridge device, dev, from bridge manager database.
 */
int nss_bridge_mgr_unregister_br(struct net_device *dev)
{
	struct nss_bridge_pvt *b_pvt;

	/*
	 * Do we have it on record?
	 */
	b_pvt = nss_bridge_mgr_find_instance(dev);
	if (!b_pvt)
		return -1;

	/*
	 * sequence of free:
	 * 1. issue VSI unassign to NSS
	 * 2. free VSI
	 * 3. flush bridge FDB table
	 * 4. unregister bridge netdevice from data plane
	 * 5. deallocate dynamic interface associated with bridge netdevice
	 * 6. free bridge netdevice
	 */
#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	/*
	 * The VSI is owned and freed by qca_ppe (when the DSA ports leave the
	 * Linux bridge); only tell the firmware to release it here.
	 */
	if (b_pvt->vsi &&
	    nss_bridge_tx_vsi_unassign_msg(b_pvt->ifnum, b_pvt->vsi) != NSS_TX_SUCCESS)
		nss_bridge_mgr_warn("%px: failed to unassign vsi\n", b_pvt);
#endif

	nss_bridge_mgr_trace("%px: Bridge %s unregsitered. Freeing bridge di %d\n", b_pvt, dev->name, b_pvt->ifnum);

	nss_bridge_unregister(b_pvt->ifnum);

	if (nss_dynamic_interface_dealloc_node(b_pvt->ifnum, NSS_DYNAMIC_INTERFACE_TYPE_BRIDGE) != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: dealloc bridge di failed\n", b_pvt);
	}

	nss_bridge_mgr_delete_instance(b_pvt);
	return 0;
}

/*
 * nss_bridge_mgr_register_br()
 *	Register new bridge instance in bridge manager database.
 */
int nss_bridge_mgr_register_br(struct net_device *dev)
{
	struct nss_bridge_pvt *b_pvt;
	struct net_device *lower;
	struct list_head *iter;
	int ifnum;
	int err;

	nss_bridge_mgr_info("%px: Bridge register: %s\n", dev, dev->name);

	b_pvt = nss_bridge_mgr_create_instance(dev);
	if (!b_pvt)
		return -EINVAL;

	b_pvt->dev = dev;

	ifnum = nss_dynamic_interface_alloc_node(NSS_DYNAMIC_INTERFACE_TYPE_BRIDGE);
	if (ifnum < 0) {
		nss_bridge_mgr_warn("%px: failed to alloc bridge di\n", b_pvt);
		goto fail;
	}

	if (!nss_bridge_register(ifnum, dev, NULL, NULL, 0, b_pvt)) {
		nss_bridge_mgr_warn("%px: failed to register bridge di to NSS\n", b_pvt);
		goto fail_1;
	}

#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	/*
	 * Reuse the shared VSI qca_ppe allocated for this Linux bridge (present
	 * once a DSA user port has joined). Assign it to the firmware bridge
	 * interface and re-assert the masks the firmware zeroes on assign. If no
	 * qca_ppe port has joined yet, the first member join assigns it.
	 */
	err = qca_ppe_bridge_vsi_get(dev);
	if (err >= 0) {
		b_pvt->vsi = err;
		if (nss_bridge_tx_vsi_assign_msg(ifnum, b_pvt->vsi) != NSS_TX_SUCCESS) {
			nss_bridge_mgr_warn("%px: failed to assign vsi msg\n", b_pvt);
			goto fail_2;
		}
		qca_ppe_bridge_vsi_refresh(dev);
	}
#endif

	err = nss_bridge_tx_set_mac_addr_msg(ifnum, dev->dev_addr);
	if (err != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: failed to set mac_addr msg, error = %d\n", b_pvt, err);
		goto fail_3;
	}

	err = nss_bridge_tx_set_mtu_msg(ifnum, dev->mtu);
	if (err != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: failed to set mtu msg, error = %d\n", b_pvt, err);
		goto fail_3;
	}

	/*
	 * All done, take a snapshot of the current mtu and mac address
	 */
	b_pvt->ifnum = ifnum;
	b_pvt->mtu = dev->mtu;
	ether_addr_copy(b_pvt->dev_addr, dev->dev_addr);
	spin_lock_bh(&br_mgr_ctx.lock);
	list_add(&b_pvt->list, &br_mgr_ctx.list);
	spin_unlock_bh(&br_mgr_ctx.lock);

	/*
	 * register_netdevice_notifier() replays NETDEV_REGISTER/UP but not
	 * NETDEV_CHANGEUPPER, so when bridge-mgr loads after the bridge already
	 * has members (the normal case here), join them now. Later members arrive
	 * via NETDEV_CHANGEUPPER. Notifier context holds rtnl, so the lower-dev
	 * walk is safe.
	 */
	netdev_for_each_lower_dev(dev, lower, iter)
		nss_bridge_mgr_join_bridge(lower, b_pvt);

	return 0;

fail_3:
#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	if (b_pvt->vsi &&
	    nss_bridge_tx_vsi_unassign_msg(ifnum, b_pvt->vsi) != NSS_TX_SUCCESS)
		nss_bridge_mgr_warn("%px: failed to unassign vsi\n", b_pvt);
fail_2:
#endif
	nss_bridge_unregister(ifnum);

fail_1:
	if (nss_dynamic_interface_dealloc_node(ifnum, NSS_DYNAMIC_INTERFACE_TYPE_BRIDGE) != NSS_TX_SUCCESS)
		nss_bridge_mgr_warn("%px: failed to dealloc bridge di\n", b_pvt);

fail:
	nss_bridge_mgr_delete_instance(b_pvt);

	return -EFAULT;
}

/*
 * nss_bridge_mgr_changemtu_event()
 *	Change bridge MTU and send change bridge MTU message to NSS FW.
 */
static int nss_bridge_mgr_changemtu_event(struct netdev_notifier_info *info)
{
	struct net_device *dev = netdev_notifier_info_to_dev(info);
	struct nss_bridge_pvt *b_pvt = nss_bridge_mgr_find_instance(dev);

	if (!b_pvt)
		return NOTIFY_DONE;

	spin_lock_bh(&br_mgr_ctx.lock);
	if (b_pvt->mtu == dev->mtu) {
		spin_unlock_bh(&br_mgr_ctx.lock);
		return NOTIFY_DONE;
	}
	spin_unlock_bh(&br_mgr_ctx.lock);

	nss_bridge_mgr_trace("%px: MTU changed to %d, send message to NSS\n", b_pvt, dev->mtu);

	if (nss_bridge_tx_set_mtu_msg(b_pvt->ifnum, dev->mtu) != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: Failed to send change MTU message to NSS\n", b_pvt);
		return NOTIFY_DONE;
	}

	spin_lock_bh(&br_mgr_ctx.lock);
	b_pvt->mtu = dev->mtu;
	spin_unlock_bh(&br_mgr_ctx.lock);

	return NOTIFY_DONE;
}

/*
 * nss_bridge_mgr_changeaddr_event()
 *	Change bridge MAC address and send change bridge address message to NSS FW.
 */
static int nss_bridge_mgr_changeaddr_event(struct netdev_notifier_info *info)
{
	struct net_device *dev = netdev_notifier_info_to_dev(info);
	struct nss_bridge_pvt *b_pvt = nss_bridge_mgr_find_instance(dev);

	if (!b_pvt)
		return NOTIFY_DONE;

	spin_lock_bh(&br_mgr_ctx.lock);
	if (!memcmp(b_pvt->dev_addr, dev->dev_addr, ETH_ALEN)) {
		spin_unlock_bh(&br_mgr_ctx.lock);
		nss_bridge_mgr_trace("%px: MAC are the same..skip processing it\n", b_pvt);
		return NOTIFY_DONE;
	}
	spin_unlock_bh(&br_mgr_ctx.lock);

	nss_bridge_mgr_trace("%px: MAC changed to %pM, update NSS\n", b_pvt, dev->dev_addr);

	if (nss_bridge_tx_set_mac_addr_msg(b_pvt->ifnum, dev->dev_addr) != NSS_TX_SUCCESS) {
		nss_bridge_mgr_warn("%px: Failed to send change MAC address message to NSS\n", b_pvt);
		return NOTIFY_DONE;
	}

	spin_lock_bh(&br_mgr_ctx.lock);
	ether_addr_copy(b_pvt->dev_addr, dev->dev_addr);
	spin_unlock_bh(&br_mgr_ctx.lock);

	return NOTIFY_DONE;
}

/*
 * nss_bridge_mgr_changeupper_event()
 *	Bridge manager handles netdevice joining or leaving bridge notification.
 */
static int nss_bridge_mgr_changeupper_event(struct netdev_notifier_info *info)
{
	struct net_device *dev = netdev_notifier_info_to_dev(info);
	struct net_device *master_dev;
	struct netdev_notifier_changeupper_info *cu_info;
	struct nss_bridge_pvt *b_pvt;

	cu_info = (struct netdev_notifier_changeupper_info *)info;

	/*
	 * Check if the master pointer is valid
	 */
	if (!cu_info->master)
		return NOTIFY_DONE;

	master_dev = cu_info->upper_dev;

	/*
	 * Check if upper_dev is a known bridge.
	 */
	b_pvt = nss_bridge_mgr_find_instance(master_dev);
	if (!b_pvt)
		return NOTIFY_DONE;

	if (cu_info->linking) {
		nss_bridge_mgr_trace("%px: Interface %s joining bridge %s\n", b_pvt, dev->name, master_dev->name);
		if (nss_bridge_mgr_join_bridge(dev, b_pvt)) {
			nss_bridge_mgr_warn("%px: Interface %s failed to join bridge %s\n", b_pvt, dev->name, master_dev->name);
		}

		return NOTIFY_DONE;
	}

	nss_bridge_mgr_trace("%px: Interface %s leaving bridge %s\n", b_pvt, dev->name, master_dev->name);
	if (nss_bridge_mgr_leave_bridge(dev, b_pvt)) {
		nss_bridge_mgr_warn("%px: Interface %s failed to leave bridge %s\n", b_pvt, dev->name, master_dev->name);
	}

	return NOTIFY_DONE;
}

/*
 * nss_bridge_mgr_register_event()
 *	Bridge manager handles bridge registration notification.
 */
static int nss_bridge_mgr_register_event(struct netdev_notifier_info *info)
{
	nss_bridge_mgr_register_br(netdev_notifier_info_to_dev(info));
	return NOTIFY_DONE;
}

/*
 * nss_bridge_mgr_unregister_event()
 *	Bridge manager handles bridge unregistration notification.
 */
static int nss_bridge_mgr_unregister_event(struct netdev_notifier_info *info)
{
	nss_bridge_mgr_unregister_br(netdev_notifier_info_to_dev(info));
	return NOTIFY_DONE;
}

/*
 * nss_bridge_mgr_netdevice_event()
 *	Bridge manager handles bridge operation notifications.
 */
static int nss_bridge_mgr_netdevice_event(struct notifier_block *unused,
				unsigned long event, void *ptr)
{
	struct netdev_notifier_info *info = (struct netdev_notifier_info *)ptr;

	switch (event) {
	case NETDEV_CHANGEUPPER:
		return nss_bridge_mgr_changeupper_event(info);
	case NETDEV_CHANGEADDR:
		return nss_bridge_mgr_changeaddr_event(info);
	case NETDEV_CHANGEMTU:
		return nss_bridge_mgr_changemtu_event(info);
	case NETDEV_REGISTER:
		return nss_bridge_mgr_register_event(info);
	case NETDEV_UNREGISTER:
		return nss_bridge_mgr_unregister_event(info);
	}

	/*
	 * Notify done for all the events we don't care
	 */
	return NOTIFY_DONE;
}

static struct notifier_block nss_bridge_mgr_netdevice_nb __read_mostly = {
	.notifier_call = nss_bridge_mgr_netdevice_event,
};

#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
/*
 * nss_bridge_mgr_is_physical_dev()
 *	Check if the device is on physical device.
 */
static bool nss_bridge_mgr_is_physical_dev(struct net_device *dev)
{
	if (!dev)
		return false;

	return NSS_BRIDGE_MGR_IF_IS_TYPE_PHYSICAL(
			nss_cmn_get_interface_number_by_dev(dev));
}

/*
 * nss_bridge_mgr_fdb_update_callback()
 *	Get invoked when there is a FDB update.
 */
static int nss_bridge_mgr_fdb_update_callback(struct notifier_block *notifier,
					      unsigned long val, void *ctx)
{
	struct br_fdb_event *event = (struct br_fdb_event *)ctx;
	struct nss_bridge_pvt *b_pvt = NULL;
	struct net_device *br_dev = NULL;

	if (!event->br)
		return NOTIFY_DONE;

	br_dev = br_fdb_bridge_dev_get_and_hold(event->br);
	if (!br_dev) {
		nss_bridge_mgr_warn("%px: bridge device not found\n", event->br);
		return NOTIFY_DONE;
	}

	nss_bridge_mgr_trace("%px: MAC: %pM, original source: %s, new source: %s, bridge: %s\n",
			event, event->addr, event->orig_dev->name, event->dev->name, br_dev->name);

	/*
	 * When a MAC address move from a physical interface to a non-physical
	 * interface, the FDB entry in the PPE needs to be flushed.
	 */
	if (!nss_bridge_mgr_is_physical_dev(event->orig_dev)) {
		nss_bridge_mgr_trace("%px: original source is not a physical interface\n", event->orig_dev);
		dev_put(br_dev);
		return NOTIFY_DONE;
	}

	if (nss_bridge_mgr_is_physical_dev(event->dev)) {
		nss_bridge_mgr_trace("%px: new source is not a non-physical interface\n", event->dev);
		dev_put(br_dev);
		return NOTIFY_DONE;
	}

	b_pvt = nss_bridge_mgr_find_instance(br_dev);
	dev_put(br_dev);
	if (!b_pvt) {
		nss_bridge_mgr_warn("%px: bridge instance not found\n", event->br);
		return NOTIFY_DONE;
	}

	if (qca_ppe_fdb_del(event->addr, b_pvt->vsi)) {
		nss_bridge_mgr_warn("%px: FDB delete failed for MAC %pM vsi %d\n",
				    b_pvt, event->addr, b_pvt->vsi);
		return NOTIFY_DONE;
	}
	return NOTIFY_OK;
}

/*
 * Notifier block for FDB update
 */
static struct notifier_block nss_bridge_mgr_fdb_update_notifier = {
	.notifier_call = nss_bridge_mgr_fdb_update_callback,
};

#endif

/*
 * nss_bridge_mgr_init_module()
 *	bridge_mgr module init function
 */
int __init nss_bridge_mgr_init_module(void)
{
	/*
	 * Monitor bridge activity only on supported platform
	 */
	if (!of_machine_is_compatible("qcom,ipq807x") && !of_machine_is_compatible("qcom,ipq6018") && !of_machine_is_compatible("qcom,ipq8074"))
		return 0;

	INIT_LIST_HEAD(&br_mgr_ctx.list);
	spin_lock_init(&br_mgr_ctx.lock);
	register_netdevice_notifier(&nss_bridge_mgr_netdevice_nb);
	nss_bridge_mgr_info("Module (Build %s) loaded\n", NSS_CLIENT_BUILD_ID);
#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	br_fdb_update_register_notify(&nss_bridge_mgr_fdb_update_notifier);
#endif
#if defined (NSS_BRIDGE_MGR_OVS_ENABLE)
	nss_bridge_mgr_ovs_init();
#endif
	return 0;
}

/*
 * nss_bridge_mgr_exit_module()
 *	bridge_mgr module exit function
 */
void __exit nss_bridge_mgr_exit_module(void)
{
	unregister_netdevice_notifier(&nss_bridge_mgr_netdevice_nb);
	nss_bridge_mgr_info("Module unloaded\n");
#if defined(NSS_BRIDGE_MGR_PPE_SUPPORT)
	br_fdb_update_unregister_notify(&nss_bridge_mgr_fdb_update_notifier);
#endif
#if defined (NSS_BRIDGE_MGR_OVS_ENABLE)
	nss_bridge_mgr_ovs_exit();
#endif
}

module_init(nss_bridge_mgr_init_module);
module_exit(nss_bridge_mgr_exit_module);

MODULE_LICENSE("Dual BSD/GPL");
MODULE_DESCRIPTION("NSS bridge manager");

module_param(ovs_enabled, bool, 0644);
MODULE_PARM_DESC(ovs_enabled, "OVS bridge is enabled");
