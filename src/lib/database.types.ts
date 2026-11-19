
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "address": {
                  Row: {
                    "address_id": string,"barangay": string,"city": string,"created_at": string,"customer_id": string,"is_default": boolean,"label": Database["public"]['Enums']["address_label"],"mobile_no": string | null,"notes": string | null,"recipient_name": string,"street": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_id"?: string,"barangay": string,"city": string,"created_at"?: string,"customer_id": string,"is_default"?: boolean,"label"?: Database["public"]['Enums']["address_label"],"mobile_no"?: string | null,"notes"?: string | null,"recipient_name": string,"street": string,"updated_at"?: string
                  }
                  Update: {
                    "address_id"?: string,"barangay"?: string,"city"?: string,"created_at"?: string,"customer_id"?: string,"is_default"?: boolean,"label"?: Database["public"]['Enums']["address_label"],"mobile_no"?: string | null,"notes"?: string | null,"recipient_name"?: string,"street"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "address_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_type": Database["public"]['Enums']["actor_type"],"after": Json | null,"audit_id": number,"before": Json | null,"created_at": string,"entity": string,"entity_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_type": Database["public"]['Enums']["actor_type"],"after"?: Json | null,"audit_id"?: never,"before"?: Json | null,"created_at"?: string,"entity": string,"entity_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_type"?: Database["public"]['Enums']["actor_type"],"after"?: Json | null,"audit_id"?: never,"before"?: Json | null,"created_at"?: string,"entity"?: string,"entity_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"automated_order": {
                  Row: {
                    "automated_order_id": string,"cafe_id": number,"contents": NonNullable<Json>,"converted_at": string | null,"converted_by": string | null,"created_at": string,"customer_id": string | null,"customer_message": string | null,"customer_mobile": string | null,"customer_name": string,"error_code": string | null,"failure_reason": string | null,"fulfillment": Database["public"]['Enums']["fulfillment_type"],"linked_order_id": string | null,"retries": number,"rule": string,"source": string,"state": Database["public"]['Enums']["automated_order_state"],"system_response": string | null,"timeline": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automated_order_id"?: string,"cafe_id": number,"contents": NonNullable<Json>,"converted_at"?: string | null,"converted_by"?: string | null,"created_at"?: string,"customer_id"?: string | null,"customer_message"?: string | null,"customer_mobile"?: string | null,"customer_name": string,"error_code"?: string | null,"failure_reason"?: string | null,"fulfillment"?: Database["public"]['Enums']["fulfillment_type"],"linked_order_id"?: string | null,"retries"?: number,"rule": string,"source": string,"state"?: Database["public"]['Enums']["automated_order_state"],"system_response"?: string | null,"timeline"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "automated_order_id"?: string,"cafe_id"?: number,"contents"?: NonNullable<Json>,"converted_at"?: string | null,"converted_by"?: string | null,"created_at"?: string,"customer_id"?: string | null,"customer_message"?: string | null,"customer_mobile"?: string | null,"customer_name"?: string,"error_code"?: string | null,"failure_reason"?: string | null,"fulfillment"?: Database["public"]['Enums']["fulfillment_type"],"linked_order_id"?: string | null,"retries"?: number,"rule"?: string,"source"?: string,"state"?: Database["public"]['Enums']["automated_order_state"],"system_response"?: string | null,"timeline"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automated_order_cafe_id_fkey"
      columns: ["cafe_id"]
isOneToOne: false
      referencedRelation: "store_settings"
      referencedColumns: ["settings_id"]
    },{
      foreignKeyName: "automated_order_converted_by_fkey"
      columns: ["converted_by"]
isOneToOne: false
      referencedRelation: "staff_user"
      referencedColumns: ["staff_id"]
    },{
      foreignKeyName: "automated_order_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "automated_order_linked_order_id_fkey"
      columns: ["linked_order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"customer": {
                  Row: {
                    "birthday": string | null,"created_at": string,"customer_id": string,"default_drink_size": string | null,"email": string | null,"favorite_cafe_id": number | null,"full_name": string,"is_demo": boolean,"mobile_no": string,"mobile_verified_at": string | null,"notify_order_updates": boolean,"notify_promotions": boolean,"notify_rewards_reminders": boolean,"points_balance": number,"promo_consent_at": string | null,"terms_accepted_at": string,"tier_id": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "birthday"?: string | null,"created_at"?: string,"customer_id": string,"default_drink_size"?: string | null,"email"?: string | null,"favorite_cafe_id"?: number | null,"full_name": string,"is_demo"?: boolean,"mobile_no": string,"mobile_verified_at"?: string | null,"notify_order_updates"?: boolean,"notify_promotions"?: boolean,"notify_rewards_reminders"?: boolean,"points_balance"?: number,"promo_consent_at"?: string | null,"terms_accepted_at": string,"tier_id": number,"updated_at"?: string
                  }
                  Update: {
                    "birthday"?: string | null,"created_at"?: string,"customer_id"?: string,"default_drink_size"?: string | null,"email"?: string | null,"favorite_cafe_id"?: number | null,"full_name"?: string,"is_demo"?: boolean,"mobile_no"?: string,"mobile_verified_at"?: string | null,"notify_order_updates"?: boolean,"notify_promotions"?: boolean,"notify_rewards_reminders"?: boolean,"points_balance"?: number,"promo_consent_at"?: string | null,"terms_accepted_at"?: string,"tier_id"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_favorite_cafe_id_fkey"
      columns: ["favorite_cafe_id"]
isOneToOne: false
      referencedRelation: "store_settings"
      referencedColumns: ["settings_id"]
    },{
      foreignKeyName: "customer_tier_id_fkey"
      columns: ["tier_id"]
isOneToOne: false
      referencedRelation: "tier"
      referencedColumns: ["tier_id"]
    }
                  ]
                },"customer_reward": {
                  Row: {
                    "customer_id": string,"customer_reward_id": string,"expires_on": string,"redeemed_at": string,"reward_id": string,"status": Database["public"]['Enums']["voucher_status"],"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "customer_id": string,"customer_reward_id"?: string,"expires_on": string,"redeemed_at"?: string,"reward_id": string,"status"?: Database["public"]['Enums']["voucher_status"],"used_at"?: string | null
                  }
                  Update: {
                    "customer_id"?: string,"customer_reward_id"?: string,"expires_on"?: string,"redeemed_at"?: string,"reward_id"?: string,"status"?: Database["public"]['Enums']["voucher_status"],"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_reward_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "customer_reward_reward_id_fkey"
      columns: ["reward_id"]
isOneToOne: false
      referencedRelation: "reward"
      referencedColumns: ["reward_id"]
    }
                  ]
                },"internal_note": {
                  Row: {
                    "author_name": string,"body": string,"created_at": string,"note_id": number,"order_id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_name": string,"body": string,"created_at"?: string,"note_id"?: never,"order_id": string,"staff_id"?: string | null
                  }
                  Update: {
                    "author_name"?: string,"body"?: string,"created_at"?: string,"note_id"?: never,"order_id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "internal_note_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "internal_note_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff_user"
      referencedColumns: ["staff_id"]
    }
                  ]
                },"login_attempt": {
                  Row: {
                    "audience": Database["public"]['Enums']["login_audience"],"fail_count": number,"identifier": string,"locked_until": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": Database["public"]['Enums']["login_audience"],"fail_count"?: number,"identifier": string,"locked_until"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: Database["public"]['Enums']["login_audience"],"fail_count"?: number,"identifier"?: string,"locked_until"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"menu_category": {
                  Row: {
                    "badge_match": string | null,"category_id": string,"is_active": boolean,"kind": Database["public"]['Enums']["category_kind"],"menu_group": string | null,"sort_order": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "badge_match"?: string | null,"category_id": string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"menu_group"?: string | null,"sort_order"?: number,"title": string
                  }
                  Update: {
                    "badge_match"?: string | null,"category_id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"menu_group"?: string | null,"sort_order"?: number,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"menu_item": {
                  Row: {
                    "badges": (string)[],"blurb": string | null,"category_id": string,"description": string,"image_url": string | null,"is_active": boolean,"is_available": boolean,"is_new": boolean,"item_id": string,"kind": Database["public"]['Enums']["menu_kind"],"name": string,"price": number | null,"sort_order": number,"unavailable_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "badges"?: (string)[],"blurb"?: string | null,"category_id": string,"description"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_available"?: boolean,"is_new"?: boolean,"item_id": string,"kind": Database["public"]['Enums']["menu_kind"],"name": string,"price"?: number | null,"sort_order"?: number,"unavailable_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "badges"?: (string)[],"blurb"?: string | null,"category_id"?: string,"description"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_available"?: boolean,"is_new"?: boolean,"item_id"?: string,"kind"?: Database["public"]['Enums']["menu_kind"],"name"?: string,"price"?: number | null,"sort_order"?: number,"unavailable_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_item_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "menu_category"
      referencedColumns: ["category_id"]
    }
                  ]
                },"notification": {
                  Row: {
                    "body": string,"channel": Database["public"]['Enums']["message_channel"],"created_at": string,"customer_id": string,"deep_link": string,"notification_id": string,"order_id": string | null,"pushed_at": string | null,"read_at": string | null,"template_id": number | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"channel"?: Database["public"]['Enums']["message_channel"],"created_at"?: string,"customer_id": string,"deep_link": string,"notification_id"?: string,"order_id"?: string | null,"pushed_at"?: string | null,"read_at"?: string | null,"template_id"?: number | null,"title": string
                  }
                  Update: {
                    "body"?: string,"channel"?: Database["public"]['Enums']["message_channel"],"created_at"?: string,"customer_id"?: string,"deep_link"?: string,"notification_id"?: string,"order_id"?: string | null,"pushed_at"?: string | null,"read_at"?: string | null,"template_id"?: number | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "notification_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "notification_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "response_template"
      referencedColumns: ["template_id"]
    }
                  ]
                },"option_group": {
                  Row: {
                    "code": string,"group_id": number,"is_required": boolean,"is_size": boolean,"item_id": string,"pick": Database["public"]['Enums']["option_pick"],"sort_order": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"group_id"?: never,"is_required"?: boolean,"is_size"?: boolean,"item_id": string,"pick"?: Database["public"]['Enums']["option_pick"],"sort_order"?: number,"title": string
                  }
                  Update: {
                    "code"?: string,"group_id"?: never,"is_required"?: boolean,"is_size"?: boolean,"item_id"?: string,"pick"?: Database["public"]['Enums']["option_pick"],"sort_order"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "option_group_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["item_id"]
    }
                  ]
                },"option_value": {
                  Row: {
                    "badge": string | null,"group_id": number,"is_available": boolean,"is_default": boolean,"label": string,"price": number,"sort_order": number,"value_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "badge"?: string | null,"group_id": number,"is_available"?: boolean,"is_default"?: boolean,"label": string,"price"?: number,"sort_order"?: number,"value_id"?: never
                  }
                  Update: {
                    "badge"?: string | null,"group_id"?: number,"is_available"?: boolean,"is_default"?: boolean,"label"?: string,"price"?: number,"sort_order"?: number,"value_id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "option_value_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "option_group"
      referencedColumns: ["group_id"]
    }
                  ]
                },"order_line": {
                  Row: {
                    "item_id": string | null,"item_name": string,"line_id": string,"line_total": number | null,"note": string | null,"order_id": string,"quantity": number,"sort_order": number,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "item_id"?: string | null,"item_name": string,"line_id"?: string,"line_total"?: never,"note"?: string | null,"order_id": string,"quantity": number,"sort_order"?: number,"unit_price": number
                  }
                  Update: {
                    "item_id"?: string | null,"item_name"?: string,"line_id"?: string,"line_total"?: never,"note"?: string | null,"order_id"?: string,"quantity"?: number,"sort_order"?: number,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_line_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "order_line_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"order_line_option": {
                  Row: {
                    "group_title": string,"label": string,"line_id": string,"price": number,"sort_order": number,"value_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "group_title": string,"label": string,"line_id": string,"price"?: number,"sort_order"?: number,"value_id"?: number | null
                  }
                  Update: {
                    "group_title"?: string,"label"?: string,"line_id"?: string,"price"?: number,"sort_order"?: number,"value_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_line_option_line_id_fkey"
      columns: ["line_id"]
isOneToOne: false
      referencedRelation: "order_line"
      referencedColumns: ["line_id"]
    },{
      foreignKeyName: "order_line_option_value_id_fkey"
      columns: ["value_id"]
isOneToOne: false
      referencedRelation: "option_value"
      referencedColumns: ["value_id"]
    }
                  ]
                },"order_status_event": {
                  Row: {
                    "actor_name": string | null,"actor_type": Database["public"]['Enums']["actor_type"],"created_at": string,"event_id": number,"from_status": Database["public"]['Enums']["order_status"] | null,"is_delay": boolean,"label": string,"new_eta": string | null,"order_id": string,"staff_id": string | null,"to_status": Database["public"]['Enums']["order_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_name"?: string | null,"actor_type": Database["public"]['Enums']["actor_type"],"created_at"?: string,"event_id"?: never,"from_status"?: Database["public"]['Enums']["order_status"] | null,"is_delay"?: boolean,"label": string,"new_eta"?: string | null,"order_id": string,"staff_id"?: string | null,"to_status"?: Database["public"]['Enums']["order_status"] | null
                  }
                  Update: {
                    "actor_name"?: string | null,"actor_type"?: Database["public"]['Enums']["actor_type"],"created_at"?: string,"event_id"?: never,"from_status"?: Database["public"]['Enums']["order_status"] | null,"is_delay"?: boolean,"label"?: string,"new_eta"?: string | null,"order_id"?: string,"staff_id"?: string | null,"to_status"?: Database["public"]['Enums']["order_status"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_status_event_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_status_event_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff_user"
      referencedColumns: ["staff_id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "accepted_at": string | null,"address_id": string | null,"cafe_id": number,"cancel_reason": string | null,"cancel_reason_code": Database["public"]['Enums']["cancel_reason_code"] | null,"cancelled_at": string | null,"cancelled_by": Database["public"]['Enums']["cancelled_by"] | null,"completed_at": string | null,"customer_id": string | null,"customer_mobile": string,"customer_name": string,"customer_reward_id": string | null,"delivery_address": Json | null,"delivery_fee": number,"eta": string,"fulfillment": Database["public"]['Enums']["fulfillment_type"],"idempotency_key": string,"is_delayed": boolean,"note": string | null,"order_id": string,"order_no": number,"placed_at": string,"points_to_earn": number,"preparing_at": string | null,"promo_discount": number,"promotion_id": string | null,"promotion_label": string | null,"ready_at": string | null,"reward_discount": number,"reward_name": string | null,"source": Database["public"]['Enums']["order_source"],"status": Database["public"]['Enums']["order_status"],"subtotal": number,"tier_discount": number,"tier_name": string | null,"total": number,"updated_at": string,"status_label": string | null,"template_event_for": Database["public"]['Enums']["template_event"] | null
                  }
                  ComputedFields: "status_label" | "template_event_for"
                  Insert: {
                    "accepted_at"?: string | null,"address_id"?: string | null,"cafe_id": number,"cancel_reason"?: string | null,"cancel_reason_code"?: Database["public"]['Enums']["cancel_reason_code"] | null,"cancelled_at"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancelled_by"] | null,"completed_at"?: string | null,"customer_id"?: string | null,"customer_mobile": string,"customer_name": string,"customer_reward_id"?: string | null,"delivery_address"?: Json | null,"delivery_fee"?: number,"eta": string,"fulfillment": Database["public"]['Enums']["fulfillment_type"],"idempotency_key": string,"is_delayed"?: boolean,"note"?: string | null,"order_id"?: string,"order_no"?: number,"placed_at"?: string,"points_to_earn"?: number,"preparing_at"?: string | null,"promo_discount"?: number,"promotion_id"?: string | null,"promotion_label"?: string | null,"ready_at"?: string | null,"reward_discount"?: number,"reward_name"?: string | null,"source"?: Database["public"]['Enums']["order_source"],"status"?: Database["public"]['Enums']["order_status"],"subtotal": number,"tier_discount"?: number,"tier_name"?: string | null,"total": number,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"address_id"?: string | null,"cafe_id"?: number,"cancel_reason"?: string | null,"cancel_reason_code"?: Database["public"]['Enums']["cancel_reason_code"] | null,"cancelled_at"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancelled_by"] | null,"completed_at"?: string | null,"customer_id"?: string | null,"customer_mobile"?: string,"customer_name"?: string,"customer_reward_id"?: string | null,"delivery_address"?: Json | null,"delivery_fee"?: number,"eta"?: string,"fulfillment"?: Database["public"]['Enums']["fulfillment_type"],"idempotency_key"?: string,"is_delayed"?: boolean,"note"?: string | null,"order_id"?: string,"order_no"?: number,"placed_at"?: string,"points_to_earn"?: number,"preparing_at"?: string | null,"promo_discount"?: number,"promotion_id"?: string | null,"promotion_label"?: string | null,"ready_at"?: string | null,"reward_discount"?: number,"reward_name"?: string | null,"source"?: Database["public"]['Enums']["order_source"],"status"?: Database["public"]['Enums']["order_status"],"subtotal"?: number,"tier_discount"?: number,"tier_name"?: string | null,"total"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_address_id_fkey"
      columns: ["address_id"]
isOneToOne: false
      referencedRelation: "address"
      referencedColumns: ["address_id"]
    },{
      foreignKeyName: "orders_cafe_id_fkey"
      columns: ["cafe_id"]
isOneToOne: false
      referencedRelation: "store_settings"
      referencedColumns: ["settings_id"]
    },{
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "orders_customer_reward_id_fkey"
      columns: ["customer_reward_id"]
isOneToOne: false
      referencedRelation: "customer_reward"
      referencedColumns: ["customer_reward_id"]
    },{
      foreignKeyName: "orders_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotion"
      referencedColumns: ["promotion_id"]
    }
                  ]
                },"payment": {
                  Row: {
                    "amount": number,"authorized_at": string | null,"captured_at": string | null,"created_at": string,"failure_reason": string | null,"method": Database["public"]['Enums']["payment_method_type"],"method_label": string,"order_id": string,"payment_id": string,"payment_method_id": string | null,"provider_ref": string | null,"refunded_at": string | null,"status": Database["public"]['Enums']["payment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"authorized_at"?: string | null,"captured_at"?: string | null,"created_at"?: string,"failure_reason"?: string | null,"method": Database["public"]['Enums']["payment_method_type"],"method_label": string,"order_id": string,"payment_id"?: string,"payment_method_id"?: string | null,"provider_ref"?: string | null,"refunded_at"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"authorized_at"?: string | null,"captured_at"?: string | null,"created_at"?: string,"failure_reason"?: string | null,"method"?: Database["public"]['Enums']["payment_method_type"],"method_label"?: string,"order_id"?: string,"payment_id"?: string,"payment_method_id"?: string | null,"provider_ref"?: string | null,"refunded_at"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payment_payment_method_id_fkey"
      columns: ["payment_method_id"]
isOneToOne: false
      referencedRelation: "payment_method"
      referencedColumns: ["method_id"]
    }
                  ]
                },"payment_method": {
                  Row: {
                    "brand": string | null,"created_at": string,"customer_id": string,"is_default": boolean,"last4": string | null,"method_id": string,"provider": string,"provider_token": string,"type": Database["public"]['Enums']["payment_method_type"],"wallet_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand"?: string | null,"created_at"?: string,"customer_id": string,"is_default"?: boolean,"last4"?: string | null,"method_id"?: string,"provider"?: string,"provider_token": string,"type": Database["public"]['Enums']["payment_method_type"],"wallet_name"?: string | null
                  }
                  Update: {
                    "brand"?: string | null,"created_at"?: string,"customer_id"?: string,"is_default"?: boolean,"last4"?: string | null,"method_id"?: string,"provider"?: string,"provider_token"?: string,"type"?: Database["public"]['Enums']["payment_method_type"],"wallet_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_method_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    }
                  ]
                },"points_txn": {
                  Row: {
                    "created_at": string,"customer_id": string,"customer_reward_id": string | null,"description": string,"order_id": string | null,"points": number,"txn_id": number,"type": Database["public"]['Enums']["points_txn_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"customer_reward_id"?: string | null,"description": string,"order_id"?: string | null,"points": number,"txn_id"?: never,"type": Database["public"]['Enums']["points_txn_type"]
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"customer_reward_id"?: string | null,"description"?: string,"order_id"?: string | null,"points"?: number,"txn_id"?: never,"type"?: Database["public"]['Enums']["points_txn_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "points_txn_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "points_txn_customer_reward_id_fkey"
      columns: ["customer_reward_id"]
isOneToOne: false
      referencedRelation: "customer_reward"
      referencedColumns: ["customer_reward_id"]
    },{
      foreignKeyName: "points_txn_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"promotion": {
                  Row: {
                    "cms_synced_at": string | null,"code": string | null,"created_at": string,"description": string,"ends_at": string,"image_url": string | null,"is_featured": boolean,"is_one_time": boolean,"is_published": boolean,"promotion_id": string,"rule": NonNullable<Json>,"starts_at": string,"target_category_id": string | null,"target_item_id": string | null,"terms": (string)[],"title": string,"usage_limit": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cms_synced_at"?: string | null,"code"?: string | null,"created_at"?: string,"description"?: string,"ends_at": string,"image_url"?: string | null,"is_featured"?: boolean,"is_one_time"?: boolean,"is_published"?: boolean,"promotion_id": string,"rule": NonNullable<Json>,"starts_at": string,"target_category_id"?: string | null,"target_item_id"?: string | null,"terms"?: (string)[],"title": string,"usage_limit"?: number | null
                  }
                  Update: {
                    "cms_synced_at"?: string | null,"code"?: string | null,"created_at"?: string,"description"?: string,"ends_at"?: string,"image_url"?: string | null,"is_featured"?: boolean,"is_one_time"?: boolean,"is_published"?: boolean,"promotion_id"?: string,"rule"?: NonNullable<Json>,"starts_at"?: string,"target_category_id"?: string | null,"target_item_id"?: string | null,"terms"?: (string)[],"title"?: string,"usage_limit"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_target_category_id_fkey"
      columns: ["target_category_id"]
isOneToOne: false
      referencedRelation: "menu_category"
      referencedColumns: ["category_id"]
    },{
      foreignKeyName: "promotion_target_item_id_fkey"
      columns: ["target_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["item_id"]
    }
                  ]
                },"promotion_redemption": {
                  Row: {
                    "created_at": string,"customer_id": string | null,"order_id": string,"promotion_id": string,"redemption_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id"?: string | null,"order_id": string,"promotion_id": string,"redemption_id"?: never
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string | null,"order_id"?: string,"promotion_id"?: string,"redemption_id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_redemption_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customer"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "promotion_redemption_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "promotion_redemption_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotion"
      referencedColumns: ["promotion_id"]
    }
                  ]
                },"response_template": {
                  Row: {
                    "audience": Database["public"]['Enums']["template_audience"],"body": string,"channel": Database["public"]['Enums']["message_channel"],"critical_reason": string | null,"enabled": boolean,"event": Database["public"]['Enums']["template_event"],"is_critical": boolean,"last_edited_at": string,"last_edited_by": string | null,"last_edited_by_name": string | null,"name": string,"template_id": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: Database["public"]['Enums']["template_audience"],"body": string,"channel": Database["public"]['Enums']["message_channel"],"critical_reason"?: string | null,"enabled"?: boolean,"event": Database["public"]['Enums']["template_event"],"is_critical"?: boolean,"last_edited_at"?: string,"last_edited_by"?: string | null,"last_edited_by_name"?: string | null,"name": string,"template_id"?: never,"title": string
                  }
                  Update: {
                    "audience"?: Database["public"]['Enums']["template_audience"],"body"?: string,"channel"?: Database["public"]['Enums']["message_channel"],"critical_reason"?: string | null,"enabled"?: boolean,"event"?: Database["public"]['Enums']["template_event"],"is_critical"?: boolean,"last_edited_at"?: string,"last_edited_by"?: string | null,"last_edited_by_name"?: string | null,"name"?: string,"template_id"?: never,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "response_template_last_edited_by_fkey"
      columns: ["last_edited_by"]
isOneToOne: false
      referencedRelation: "staff_user"
      referencedColumns: ["staff_id"]
    }
                  ]
                },"reward": {
                  Row: {
                    "cost_pts": number,"created_at": string,"eligible_items": NonNullable<Json>,"goal_label": string | null,"image_url": string | null,"is_active": boolean,"name": string,"reward_id": string,"sort_order": number,"terms": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_pts": number,"created_at"?: string,"eligible_items": NonNullable<Json>,"goal_label"?: string | null,"image_url"?: string | null,"is_active"?: boolean,"name": string,"reward_id": string,"sort_order"?: number,"terms"?: (string)[]
                  }
                  Update: {
                    "cost_pts"?: number,"created_at"?: string,"eligible_items"?: NonNullable<Json>,"goal_label"?: string | null,"image_url"?: string | null,"is_active"?: boolean,"name"?: string,"reward_id"?: string,"sort_order"?: number,"terms"?: (string)[]
                  }
                  Relationships: [
                    
                  ]
                },"staff_user": {
                  Row: {
                    "cafe_id": number,"created_at": string,"email": string | null,"full_name": string,"is_active": boolean,"role": Database["public"]['Enums']["staff_role"],"staff_id": string,"updated_at": string,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cafe_id": number,"created_at"?: string,"email"?: string | null,"full_name": string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["staff_role"],"staff_id": string,"updated_at"?: string,"username": string
                  }
                  Update: {
                    "cafe_id"?: number,"created_at"?: string,"email"?: string | null,"full_name"?: string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["staff_role"],"staff_id"?: string,"updated_at"?: string,"username"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_user_cafe_id_fkey"
      columns: ["cafe_id"]
isOneToOne: false
      referencedRelation: "store_settings"
      referencedColumns: ["settings_id"]
    }
                  ]
                },"store_settings": {
                  Row: {
                    "accepting_orders": boolean,"address": string | null,"auto_advance_demo": boolean,"cafe_name": string,"campaign_modal_days": number,"default_prep_minutes": number,"delivery_enabled": boolean,"delivery_eta_minutes": number,"delivery_fee": number,"demo_mode": boolean,"lockout_attempts": number,"lockout_minutes": number,"new_order_chime": boolean,"opening_hours": NonNullable<Json>,"points_per_peso": number,"settings_id": number,"timezone": string,"updated_at": string,"updated_by": string | null,"voucher_reminder_days": number,"voucher_valid_days": number,"waiting_flag_minutes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepting_orders"?: boolean,"address"?: string | null,"auto_advance_demo"?: boolean,"cafe_name": string,"campaign_modal_days"?: number,"default_prep_minutes"?: number,"delivery_enabled"?: boolean,"delivery_eta_minutes"?: number,"delivery_fee"?: number,"demo_mode"?: boolean,"lockout_attempts"?: number,"lockout_minutes"?: number,"new_order_chime"?: boolean,"opening_hours": NonNullable<Json>,"points_per_peso"?: number,"settings_id"?: never,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"voucher_reminder_days"?: number,"voucher_valid_days"?: number,"waiting_flag_minutes"?: number
                  }
                  Update: {
                    "accepting_orders"?: boolean,"address"?: string | null,"auto_advance_demo"?: boolean,"cafe_name"?: string,"campaign_modal_days"?: number,"default_prep_minutes"?: number,"delivery_enabled"?: boolean,"delivery_eta_minutes"?: number,"delivery_fee"?: number,"demo_mode"?: boolean,"lockout_attempts"?: number,"lockout_minutes"?: number,"new_order_chime"?: boolean,"opening_hours"?: NonNullable<Json>,"points_per_peso"?: number,"settings_id"?: never,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"voucher_reminder_days"?: number,"voucher_valid_days"?: number,"waiting_flag_minutes"?: number
                  }
                  Relationships: [
                    
                  ]
                },"tier": {
                  Row: {
                    "created_at": string,"description": string | null,"discount_pct": number,"is_default": boolean,"name": string,"qualify_days": number | null,"qualify_orders": number | null,"rank": number,"tier_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"discount_pct": number,"is_default"?: boolean,"name": string,"qualify_days"?: number | null,"qualify_orders"?: number | null,"rank": number,"tier_id"?: never
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"discount_pct"?: number,"is_default"?: boolean,"name"?: string,"qualify_days"?: number | null,"qualify_orders"?: number | null,"rank"?: number,"tier_id"?: never
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "actor_name":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"check_promo_code":
{ Args: { "p_code": string }; Returns: Json
                           },
"create_order":
{ Args: { "p": Json }; Returns: {
              "accepted_at": string | null,
"address_id": string | null,
"cafe_id": number,
"cancel_reason": string | null,
"cancel_reason_code": Database["public"]['Enums']["cancel_reason_code"] | null,
"cancelled_at": string | null,
"cancelled_by": Database["public"]['Enums']["cancelled_by"] | null,
"completed_at": string | null,
"customer_id": string | null,
"customer_mobile": string,
"customer_name": string,
"customer_reward_id": string | null,
"delivery_address": Json | null,
"delivery_fee": number,
"eta": string,
"fulfillment": Database["public"]['Enums']["fulfillment_type"],
"idempotency_key": string,
"is_delayed": boolean,
"note": string | null,
"order_id": string,
"order_no": number,
"placed_at": string,
"points_to_earn": number,
"preparing_at": string | null,
"promo_discount": number,
"promotion_id": string | null,
"promotion_label": string | null,
"ready_at": string | null,
"reward_discount": number,
"reward_name": string | null,
"source": Database["public"]['Enums']["order_source"],
"status": Database["public"]['Enums']["order_status"],
"subtotal": number,
"tier_discount": number,
"tier_name": string | null,
"total": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"current_actor":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["actor_type"]
                           },
"customer_login_address":
{ Args: { "p_identifier": string }; Returns: string
                           },
"demo_mode_on":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"demo_set_order_state":
{ Args: { "p_fulfillment"?: Database["public"]['Enums']["fulfillment_type"],"p_order_no": number,"p_status": Database["public"]['Enums']["order_status"] }; Returns: undefined
                           },
"demo_set_points":
{ Args: { "p_points": number }; Returns: undefined
                           },
"housekeeping":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"is_mobile_registered":
{ Args: { "p_mobile": string }; Returns: boolean
                           },
"is_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"login_failed":
{ Args: { "p_audience": Database["public"]['Enums']["login_audience"],"p_identifier": string }; Returns: Json
                           },
"login_locked_until":
{ Args: { "p_audience": Database["public"]['Enums']["login_audience"],"p_identifier": string }; Returns: string
                           },
"login_succeeded":
{ Args: { "p_audience": Database["public"]['Enums']["login_audience"],"p_identifier": string }; Returns: undefined
                           },
"notify_order":
{ Args: { "p_event": Database["public"]['Enums']["template_event"],"p_extra"?: Json,"p_order": Omit<Database["public"]['Tables']["orders"]['Row'], Database["public"]['Tables']["orders"]['ComputedFields']> }; Returns: undefined
                           },
"order_next_statuses":
{ Args: { "p_status": Database["public"]['Enums']["order_status"] }; Returns: (Database["public"]['Enums']["order_status"])[]
                           },
"redeem_reward":
{ Args: { "p_reward_id": string }; Returns: {
              "customer_id": string,
"customer_reward_id": string,
"expires_on": string,
"redeemed_at": string,
"reward_id": string,
"status": Database["public"]['Enums']["voucher_status"],
"used_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "customer_reward"
        isOneToOne: true
        isSetofReturn: false
      } },
"render_template":
{ Args: { "p_body": string,"p_extra"?: Json,"p_order": Omit<Database["public"]['Tables']["orders"]['Row'], Database["public"]['Tables']["orders"]['ComputedFields']> }; Returns: string
                           },
"staff_login_address":
{ Args: { "p_identifier": string }; Returns: string
                           },
"staff_order_payments":
{ Args: { "p_order_id": string }; Returns: {
              "amount": number,
"authorized_at": string | null,
"captured_at": string | null,
"created_at": string,
"failure_reason": string | null,
"method": Database["public"]['Enums']["payment_method_type"],
"method_label": string,
"order_id": string,
"payment_id": string,
"payment_method_id": string | null,
"provider_ref": string | null,
"refunded_at": string | null,
"status": Database["public"]['Enums']["payment_status"],
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "payment"
        isOneToOne: false
        isSetofReturn: true
      } },
"staff_payments":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount": number,
"authorized_at": string | null,
"captured_at": string | null,
"created_at": string,
"failure_reason": string | null,
"method": Database["public"]['Enums']["payment_method_type"],
"method_label": string,
"order_id": string,
"payment_id": string,
"payment_method_id": string | null,
"provider_ref": string | null,
"refunded_at": string | null,
"status": Database["public"]['Enums']["payment_status"],
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "payment"
        isOneToOne: false
        isSetofReturn: true
      } },
"status_label":
{ Args: { "p_order": Omit<Database["public"]['Tables']["orders"]['Row'], Database["public"]['Tables']["orders"]['ComputedFields']> }; Returns: string
                           },
"sync_order_no_seq":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"template_event_for":
{ Args: { "p_order": Omit<Database["public"]['Tables']["orders"]['Row'], Database["public"]['Tables']["orders"]['ComputedFields']> }; Returns: Database["public"]['Enums']["template_event"]
                           },
"to_e164":
{ Args: { "p": string }; Returns: string
                           },
"undo_accept_window":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "actor_type": "customer"|"staff"|"system","address_label": "Home"|"Work"|"Other","automated_order_state": "queued"|"processing"|"succeeded"|"failed","cancel_reason_code": "out_of_stock"|"too_busy"|"customer_request"|"payment_issue"|"other","cancelled_by": "customer"|"cafe","category_kind": "board"|"collection","fulfillment_type": "pickup"|"delivery","login_audience": "customer"|"staff","menu_kind": "drink"|"food","message_channel": "push"|"in_app","option_pick": "one"|"many","order_source": "app"|"automated","order_status": "Received"|"Accepted"|"Preparing"|"Ready"|"Completed"|"Cancelled","payment_method_type": "card"|"e_wallet"|"counter","payment_status": "pending"|"authorized"|"captured"|"failed"|"refunded","points_txn_type": "earn"|"redeem"|"restore"|"adjust","staff_role": "staff"|"manager","template_audience": "customer"|"staff","template_event": "order_received"|"order_accepted"|"order_preparing"|"order_ready_pickup"|"order_ready_delivery"|"order_completed"|"order_cancelled_cafe"|"order_cancelled_customer"|"order_delayed"|"item_unavailable"|"payment_failed"|"staff_new_order"|"staff_automation_failed"|"staff_order_waiting","voucher_status": "unused"|"used"|"expired"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "actor_type": ["customer", "staff", "system"],"address_label": ["Home", "Work", "Other"],"automated_order_state": ["queued", "processing", "succeeded", "failed"],"cancel_reason_code": ["out_of_stock", "too_busy", "customer_request", "payment_issue", "other"],"cancelled_by": ["customer", "cafe"],"category_kind": ["board", "collection"],"fulfillment_type": ["pickup", "delivery"],"login_audience": ["customer", "staff"],"menu_kind": ["drink", "food"],"message_channel": ["push", "in_app"],"option_pick": ["one", "many"],"order_source": ["app", "automated"],"order_status": ["Received", "Accepted", "Preparing", "Ready", "Completed", "Cancelled"],"payment_method_type": ["card", "e_wallet", "counter"],"payment_status": ["pending", "authorized", "captured", "failed", "refunded"],"points_txn_type": ["earn", "redeem", "restore", "adjust"],"staff_role": ["staff", "manager"],"template_audience": ["customer", "staff"],"template_event": ["order_received", "order_accepted", "order_preparing", "order_ready_pickup", "order_ready_delivery", "order_completed", "order_cancelled_cafe", "order_cancelled_customer", "order_delayed", "item_unavailable", "payment_failed", "staff_new_order", "staff_automation_failed", "staff_order_waiting"],"voucher_status": ["unused", "used", "expired"]
          }
        }
} as const
