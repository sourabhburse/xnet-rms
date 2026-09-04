import React, { useState } from 'react';
import { Modal, Form, Input, message, Alert } from 'antd';
import { claimDevice } from '../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ClaimDeviceModal: React.FC<Props> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await claimDevice(values);
      message.success('Device claimed successfully! Waiting for router check-in.');
      form.resetFields();
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Failed to claim device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Claim Niseva Router"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={loading}
      okText="Claim Router"
    >
      <Alert
        message="Anti-Hijacking Verification"
        description="Please check the physical label underneath your router to find the Serial Number, MAC, and random Device Secret."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item
          name="serial_number"
          label="Router Serial Number"
          rules={[{ required: true, message: 'Please enter the Serial Number' }]}
        >
          <Input placeholder="e.g. NSV-2S-2026-00412" />
        </Form.Item>
        <Form.Item
          name="mac_address"
          label="Primary MAC Address"
          rules={[{ required: true, message: 'Please enter the MAC address' }]}
        >
          <Input placeholder="e.g. 00:1A:2B:3C:4D:5E" />
        </Form.Item>
        <Form.Item
          name="device_secret"
          label="Factory Device Secret (PIN)"
          rules={[{ required: true, message: 'Please enter the Device Secret printed on the label' }]}
          extra="This random factory code proves physical possession of the router."
        >
          <Input.Password placeholder="e.g. k8#mP92x" />
        </Form.Item>
        <Form.Item name="name" label="Device Alias / Name (Optional)">
          <Input placeholder="e.g. Solar Farm Site 1" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
